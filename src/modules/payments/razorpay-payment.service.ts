import crypto from 'node:crypto'
import type { Request } from 'express'
import { env } from '../../config/env.js'
import {
  Customer,
  FinalInvoice,
  InvoiceAllocation,
  InvoicePayment,
  PaymentRequest,
  RazorpayWebhookEvent,
  Tenant,
} from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { roundMoney } from '../estimates/estimate-calculation.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { computeInvoiceBalanceDue } from '../billing/ar-receivables.service.js'
import { onInvoiceSettlementChanged } from '../workflow/workflow-engine.service.js'
import { getRazorpayClient, inrToPaise } from './razorpay.config.js'
import { sendTransactionalEmail, sendWhatsAppNotify } from '../../utils/outbound-notify.js'

export async function listPaymentRequestsForInvoice(tenantId: string, invoiceId: string) {
  return PaymentRequest.find({ tenantId, invoiceId }).sort({ createdAt: -1 }).lean()
}

export async function getCollectibleAmount(inv: { balanceDue?: number; status?: string }) {
  if (inv.status !== 'ISSUED') throw new ValidationError('Issued invoice required')
  const due = roundMoney(inv.balanceDue ?? 0)
  if (due <= 0) throw new ValidationError('No collectible balance on invoice')
  return due
}

export async function createRazorpayPaymentLink(req: Request, invoiceId: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const dup = await PaymentRequest.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return dup
  }

  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new NotFoundError('Issued invoice not found')

  const collectible = await getCollectibleAmount(inv)

  const active = await PaymentRequest.findOne({
    tenantId: req.tenantId!,
    invoiceId: inv._id,
    reconciliationStatus: { $in: ['PENDING', 'PARTIALLY_RECONCILED'] },
    expiresAt: { $gt: new Date() },
  })
  if (active && !idempotencyKey) {
    return active
  }

  const customer = await Customer.findById(inv.customerId).lean()
  if (!customer?.mobile && !customer?.email) {
    throw new ValidationError('Customer email or mobile required for payment link')
  }

  const referenceId = `ZS-${inv.invoiceNumber}-${Date.now()}`.slice(0, 40)
  const expireBy = Math.floor(
    (Date.now() + env.RAZORPAY_PAYMENT_LINK_EXPIRY_HOURS * 60 * 60 * 1000) / 1000,
  )

  const rzp = getRazorpayClient()
  const link = await rzp.paymentLink.create({
    amount: inrToPaise(collectible),
    currency: env.RAZORPAY_CURRENCY,
    accept_partial: true,
    reference_id: referenceId,
    description: `Invoice ${inv.invoiceNumber}`,
    customer: {
      name: customer.name,
      email: customer.email ?? undefined,
      contact: customer.mobile?.replace(/\D/g, '').slice(-10),
    },
    expire_by: expireBy,
    notify: { sms: false, email: false },
  })

  const pr = await PaymentRequest.create({
    tenantId: req.tenantId!,
    branchId: inv.branchId,
    invoiceId: inv._id,
    invoiceNumber: inv.invoiceNumber,
    customerId: inv.customerId,
    serviceVisitId: inv.serviceVisitId,
    currency: env.RAZORPAY_CURRENCY,
    requestedAmount: collectible,
    remainingAmount: collectible,
    razorpayPaymentLinkId: link.id,
    razorpayReferenceId: referenceId,
    razorpayShortUrl: link.short_url,
    providerStatus: link.status ?? 'created',
    expiresAt: new Date(expireBy * 1000),
    createdBy: req.user?.id,
    idempotencyKey,
  })

  await createAuditLog({ req, module: 'razorpay', action: 'PAYMENT_LINK_CREATED', recordId: pr._id.toString() })
  return pr
}

export async function refreshRazorpayPaymentStatus(req: Request, paymentRequestId: string) {
  const pr = await PaymentRequest.findOne({ _id: paymentRequestId, tenantId: req.tenantId! })
  if (!pr) throw new NotFoundError('Payment request not found')
  if (!pr.razorpayPaymentLinkId) throw new ValidationError('No Razorpay link on record')

  const rzp = getRazorpayClient()
  const link = await rzp.paymentLink.fetch(pr.razorpayPaymentLinkId)
  pr.providerStatus = link.status ?? pr.providerStatus
  pr.lastVerifiedAt = new Date()
  await pr.save()

  const linkPayments = (link as unknown as { payments?: Array<{ payment_id?: string; status?: string }> }).payments
  if (linkPayments) {
    for (const p of linkPayments) {
      if (p.payment_id && p.status === 'captured') {
        await reconcileCapturedPayment({
          tenantId: req.tenantId!,
          paymentRequestId: pr._id.toString(),
          razorpayPaymentId: p.payment_id,
          req,
        })
      }
    }
  }

  const inv = await FinalInvoice.findById(pr.invoiceId)
  return { paymentRequest: pr, invoice: inv }
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET ?? env.RAZORPAY_WEBHOOK_SECRET)?.trim()
  if (!secret) return false
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  return expected === signature
}

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string | undefined) {
  if (!verifyWebhookSignature(rawBody, signature)) {
    throw new ValidationError('Invalid Razorpay webhook signature')
  }

  const payload = JSON.parse(rawBody.toString('utf8')) as {
    event?: string
    id?: string
    payload?: { payment?: { entity?: Record<string, unknown> }; payment_link?: { entity?: Record<string, unknown> } }
  }

  const eventId = payload.id ?? crypto.createHash('sha256').update(rawBody).digest('hex')
  const existing = await RazorpayWebhookEvent.findOne({ providerEventId: eventId })
  if (existing?.processingStatus === 'PROCESSED') {
    return { duplicate: true }
  }

  const evt = await RazorpayWebhookEvent.findOneAndUpdate(
    { providerEventId: eventId },
    {
      $setOnInsert: {
        providerEventId: eventId,
        eventType: payload.event,
        payload,
        processingStatus: 'RECEIVED',
      },
    },
    { upsert: true, new: true },
  )

  try {
    const paymentEntity = payload.payload?.payment?.entity as Record<string, unknown> | undefined
    const linkEntity = payload.payload?.payment_link?.entity as Record<string, unknown> | undefined

    if (paymentEntity?.status === 'captured' && paymentEntity.id) {
      const linkId = (paymentEntity.payment_link_id ?? linkEntity?.id) as string | undefined
      const pr = linkId
        ? await PaymentRequest.findOne({ razorpayPaymentLinkId: linkId })
        : await PaymentRequest.findOne({ razorpayReferenceId: paymentEntity.reference_id as string })
      if (pr) {
        await reconcileCapturedPayment({
          tenantId: pr.tenantId.toString(),
          paymentRequestId: pr._id.toString(),
          razorpayPaymentId: String(paymentEntity.id),
          amountPaise: Number(paymentEntity.amount ?? 0),
          currency: String(paymentEntity.currency ?? 'INR'),
          req: null,
        })
      }
    }

    evt.processingStatus = 'PROCESSED'
    evt.processedAt = new Date()
    await evt.save()
    return { duplicate: false }
  } catch (e) {
    evt.processingStatus = 'FAILED'
    evt.errorDetails = e instanceof Error ? e.message : 'Webhook processing failed'
    await evt.save()
    throw e
  }
}

export async function reconcileCapturedPayment(input: {
  tenantId: string
  paymentRequestId: string
  razorpayPaymentId: string
  amountPaise?: number
  currency?: string
  req: Request | null
}) {
  const pr = await PaymentRequest.findOne({ _id: input.paymentRequestId, tenantId: input.tenantId })
  if (!pr) throw new NotFoundError('Payment request not found')

  const inv = await FinalInvoice.findOne({ _id: pr.invoiceId, tenantId: input.tenantId, status: 'ISSUED' })
  if (!inv) throw new NotFoundError('Invoice not found')

  const existingPay = await InvoicePayment.findOne({
    tenantId: input.tenantId,
    transactionReference: input.razorpayPaymentId,
  })
  if (existingPay) return { duplicate: true, payment: existingPay }

  const amountInr = input.amountPaise
    ? roundMoney(input.amountPaise / 100)
    : roundMoney(Math.min(pr.remainingAmount, inv.balanceDue ?? 0))

  if (input.currency && input.currency !== env.RAZORPAY_CURRENCY) {
    throw new ValidationError('Currency mismatch on Razorpay payment')
  }
  if (amountInr <= 0) throw new ValidationError('Invalid captured amount')
  if (amountInr > (inv.balanceDue ?? 0) + 0.01) {
    throw new ValidationError('Captured amount exceeds invoice balance due')
  }

  const receiptNumber = await generateDocumentNumber(input.tenantId, 'INVOICE_PAYMENT')
  const payment = await InvoicePayment.create({
    tenantId: input.tenantId,
    branchId: inv.branchId,
    invoiceId: inv._id,
    customerId: inv.customerId,
    serviceVisitId: inv.serviceVisitId,
    receiptNumber,
    amount: amountInr,
    paymentMethod: 'RAZORPAY',
    transactionReference: input.razorpayPaymentId,
    verificationStatus: 'VERIFIED',
    verifiedAt: new Date(),
    verifiedBy: input.req?.user?.id,
    remarks: `Razorpay capture ${input.razorpayPaymentId}`,
    idempotencyKey: `rzp_${input.razorpayPaymentId}`,
  })

  await InvoiceAllocation.create({
    tenantId: input.tenantId,
    invoiceId: inv._id,
    invoicePaymentId: payment._id,
    amount: amountInr,
    allocationType: 'PAYMENT',
    allocatedBy: input.req?.user?.id,
    idempotencyKey: `rzp_alloc_${input.razorpayPaymentId}`,
  })

  inv.paymentsReceived = roundMoney((inv.paymentsReceived ?? 0) + amountInr)
  inv.balanceDue = computeInvoiceBalanceDue({
    grandTotal: inv.grandTotal ?? 0,
    advanceAllocated: inv.advanceAllocated,
    paymentsReceived: inv.paymentsReceived,
    creditsApplied: inv.creditsApplied,
  })
  inv.paymentStatus = inv.balanceDue <= 0 ? 'PAID' : 'PARTIALLY_PAID'
  await inv.save()

  pr.amountPaid = roundMoney((pr.amountPaid ?? 0) + amountInr)
  pr.remainingAmount = roundMoney(Math.max(0, pr.requestedAmount - pr.amountPaid))
  pr.razorpayPaymentIds = [...new Set([...(pr.razorpayPaymentIds ?? []), input.razorpayPaymentId])]
  pr.reconciliationStatus =
    pr.remainingAmount <= 0 ? 'RECONCILED' : 'PARTIALLY_RECONCILED'
  pr.lastVerifiedAt = new Date()
  await pr.save()

  await onInvoiceSettlementChanged(
    input.req,
    input.tenantId,
    inv.serviceVisitId.toString(),
    inv.balanceDue ?? 0,
    inv.paymentStatus ?? 'UNPAID',
  )

  if (input.req) {
    await createAuditLog({
      req: input.req,
      module: 'razorpay',
      action: 'PAYMENT_RECONCILED',
      recordId: pr._id.toString(),
      newValue: { razorpayPaymentId: input.razorpayPaymentId, amountInr },
    })
  }

  return { duplicate: false, payment, invoice: inv }
}

export async function sendPaymentLinkEmail(req: Request, paymentRequestId: string, recipient: string) {
  const pr = await PaymentRequest.findOne({ _id: paymentRequestId, tenantId: req.tenantId! })
  if (!pr?.razorpayShortUrl) throw new NotFoundError('Payment link not found')
  const inv = await FinalInvoice.findById(pr.invoiceId).lean()
  const tenant = await Tenant.findById(req.tenantId!).lean()
  const customer = await Customer.findById(pr.customerId).lean()

  const subject = `Payment Request — Vehicle Repair Invoice ${inv?.invoiceNumber ?? ''}`
  const html = `
    <p>Hello ${customer?.name ?? 'Customer'},</p>
    <p>Invoice <strong>${inv?.invoiceNumber}</strong> — amount due <strong>₹${pr.remainingAmount}</strong></p>
    <p><a href="${pr.razorpayShortUrl}">Pay securely via Razorpay</a></p>
    <p>Link expires: ${pr.expiresAt?.toLocaleString() ?? '—'}</p>
    <p>${tenant?.name ?? 'Workshop'}</p>
  `
  const result = await sendTransactionalEmail({ to: recipient, subject, text: html.replace(/<[^>]+>/g, ' '), html })
  pr.sharingHistory.push({
    channel: 'EMAIL',
    recipient,
    status: result.status,
    errorDetails: result.errorDetails,
    sentAt: new Date(),
  })
  await pr.save()
  return { email: result, paymentRequest: pr }
}

export async function sendPaymentLinkWhatsApp(req: Request, paymentRequestId: string, recipient: string) {
  const pr = await PaymentRequest.findOne({ _id: paymentRequestId, tenantId: req.tenantId! })
  if (!pr?.razorpayShortUrl) throw new NotFoundError('Payment link not found')
  const inv = await FinalInvoice.findById(pr.invoiceId).lean()
  const customer = await Customer.findById(pr.customerId).lean()
  const tenant = await Tenant.findById(req.tenantId!).lean()

  const message = `Hello ${customer?.name ?? 'Customer'},\n\nYour vehicle service invoice ${inv?.invoiceNumber} is ready.\nAmount due: ₹${pr.remainingAmount}\n\nPay securely: ${pr.razorpayShortUrl}\n\nThank you,\n${tenant?.name ?? 'Workshop'}`
  const result = await sendWhatsAppNotify({ to: recipient, body: message })
  pr.sharingHistory.push({
    channel: 'WHATSAPP',
    recipient,
    status: result.status,
    providerReference: result.providerReference,
    errorDetails: result.errorDetails,
    sentAt: new Date(),
  })
  await pr.save()
  return { whatsapp: result, paymentRequest: pr }
}

export async function cancelRazorpayPaymentLink(req: Request, paymentRequestId: string, reason?: string) {
  const pr = await PaymentRequest.findOne({ _id: paymentRequestId, tenantId: req.tenantId! })
  if (!pr?.razorpayPaymentLinkId) throw new NotFoundError('Payment link not found')
  if (pr.reconciliationStatus === 'RECONCILED') {
    throw new ValidationError('Cannot cancel a fully reconciled payment link')
  }
  const rzp = getRazorpayClient()
  await rzp.paymentLink.cancel(pr.razorpayPaymentLinkId)
  pr.set('cancelReason', reason ?? 'Superseded by workshop')
  pr.providerStatus = 'cancelled'
  pr.reconciliationStatus = 'CANCELLED'
  await pr.save()
  await createAuditLog({ req, module: 'razorpay', action: 'PAYMENT_LINK_CANCELLED', recordId: paymentRequestId })
  return pr
}

export async function getRazorpayPaymentsDashboard(req: Request, filter: { status?: string }) {
  const q: Record<string, unknown> = { tenantId: req.tenantId! }
  if (req.branchId) q.branchId = req.branchId
  if (filter.status) q.reconciliationStatus = filter.status
  const items = await PaymentRequest.find(q).sort({ updatedAt: -1 }).limit(100).populate('invoiceId', 'invoiceNumber balanceDue paymentStatus grandTotal').populate('customerId', 'name mobile').lean()
  const summary = await PaymentRequest.aggregate([
    { $match: { tenantId: req.tenantId! } },
    {
      $group: {
        _id: '$reconciliationStatus',
        count: { $sum: 1 },
        collected: { $sum: '$amountPaid' },
      },
    },
  ])
  return { items, summary }
}
