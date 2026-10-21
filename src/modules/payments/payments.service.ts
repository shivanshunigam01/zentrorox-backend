import type { Request } from 'express'
import {
  AdvancePayment,
  Booking,
  Branch,
  Customer,
  Estimate,
  FinancialAuthorization,
  Receipt,
  ReceiptCommunication,
  ServiceVisit,
  Tenant,
  Vehicle,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { createAuditLog } from '../../utils/audit.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js'
import { generateReceiptPdfBuffer } from './receipt-pdf.service.js'
import { sendTransactionalEmail, sendWhatsAppNotify } from '../../utils/outbound-notify.js'
import { evaluateFinancialAuthorization } from '../approvals/financial-auth.service.js'

function tenantFilter(req: Request) {
  return {
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }
}

function currentRevision(doc: unknown) {
  const d = doc as { revisions: Array<Record<string, unknown>>; currentRevisionNumber: number }
  return d.revisions.find((r) => r.revisionNumber === d.currentRevisionNumber) as {
    totals?: { finalAmount?: number }
  } | undefined
}

export async function listAdvancesByVisit(req: Request, visitId: string) {
  const items = await AdvancePayment.find({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
  }).sort({ createdAt: -1 }).lean()
  const receipts = await Receipt.find({
    tenantId: req.tenantId!,
    advancePaymentId: { $in: items.map((i) => i._id) },
  }).lean()
  const receiptMap = new Map(receipts.map((r) => [r.advancePaymentId.toString(), r]))
  return items.map((a) => ({
    id: a._id.toString(),
    advanceReference: a.advanceReference,
    receivedAmount: a.receivedAmount,
    paymentMode: a.paymentMode,
    verificationStatus: a.verificationStatus,
    paymentDate: a.paymentDate,
    receiptNumber: receiptMap.get(a._id.toString())?.receiptNumber,
    receiptId: receiptMap.get(a._id.toString())?._id.toString(),
  }))
}

export async function createAdvance(
  req: Request,
  body: {
    serviceVisitId: string
    receivedAmount: number
    paymentMode: string
    paymentReference?: string
    bankUpiReference?: string
    remarks?: string
    paymentDate?: string
    idempotencyKey?: string
  },
) {
  if (body.receivedAmount <= 0) {
    throw new ValidationError('Advance amount must be greater than zero when recording payment')
  }
  if (body.idempotencyKey) {
    const existing = await AdvancePayment.findOne({
      tenantId: req.tenantId!,
      idempotencyKey: body.idempotencyKey,
    }).lean()
    if (existing) {
      const receipt = await Receipt.findOne({ advancePaymentId: existing._id }).lean()
      return { advance: existing, receipt, duplicate: true }
    }
  }

  const visit = await ServiceVisit.findOne({
    _id: body.serviceVisitId,
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }).lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const estimate = await Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).lean()
  const rev = estimate ? currentRevision(estimate) : null

  const isCash = body.paymentMode === 'CASH'
  const canConfirmCash = req.user?.permissions.includes('payments.verify') || req.user?.permissions.includes('billing.create')
  const verificationStatus = isCash && canConfirmCash ? 'CONFIRMED' : 'PENDING_VERIFICATION'

  const advanceReference = await generateDocumentNumber(req.tenantId!, 'ADVANCE_PAYMENT')
  const advance = await AdvancePayment.create({
    tenantId: req.tenantId!,
    branchId: visit.branchId,
    advanceReference,
    customerId: visit.customerId,
    vehicleId: visit.vehicleId,
    bookingId: visit.bookingId,
    serviceVisitId: visit._id,
    estimateId: estimate?._id,
    estimateRevisionNumber: estimate?.currentRevisionNumber,
    approvedAmount: rev?.totals?.finalAmount,
    receivedAmount: body.receivedAmount,
    paymentMode: body.paymentMode,
    paymentReference: body.paymentReference,
    bankUpiReference: body.bankUpiReference,
    remarks: body.remarks,
    paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
    receivedBy: req.user?.id,
    receivedAt: new Date(),
    confirmedAt: verificationStatus === 'CONFIRMED' ? new Date() : undefined,
    verificationStatus,
    idempotencyKey: body.idempotencyKey,
    allocationAmount: body.receivedAmount,
    unallocatedAmount: 0,
  })

  let receipt = null
  if (verificationStatus === 'CONFIRMED') {
    receipt = await issueReceiptForAdvance(req, advance._id.toString())
  }

  await evaluateFinancialAuthorization(req, visit._id.toString())
  await createAuditLog({
    req,
    module: 'payments',
    action: 'ADVANCE_RECORDED',
    recordId: advance._id.toString(),
    newValue: { amount: body.receivedAmount, mode: body.paymentMode, status: verificationStatus },
  })

  return { advance, receipt, duplicate: false }
}

export async function verifyAdvance(req: Request, id: string) {
  if (!req.user?.permissions.includes('payments.verify') && !req.user?.permissions.includes('billing.create')) {
    throw new ForbiddenError('Cashier or finance permission required to verify payment')
  }
  const advance = await AdvancePayment.findOne({ _id: id, ...tenantFilter(req) })
  if (!advance) throw new NotFoundError('Advance payment not found')
  if (advance.verificationStatus === 'CONFIRMED') {
    const receipt = await Receipt.findOne({ advancePaymentId: advance._id }).lean()
    return { advance, receipt }
  }
  if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(advance.verificationStatus)) {
    throw new ValidationError('Cannot verify payment in current status')
  }
  advance.verificationStatus = 'CONFIRMED'
  advance.confirmedAt = new Date()
  await advance.save()
  const receipt = await issueReceiptForAdvance(req, advance._id.toString())
  await evaluateFinancialAuthorization(req, advance.serviceVisitId.toString())
  await createAuditLog({ req, module: 'payments', action: 'ADVANCE_VERIFIED', recordId: id })
  return { advance, receipt }
}

async function issueReceiptForAdvance(req: Request, advanceId: string) {
  const existing = await Receipt.findOne({ tenantId: req.tenantId!, advancePaymentId: advanceId })
  if (existing) return existing

  const advance = await AdvancePayment.findById(advanceId).lean()
  if (!advance) throw new NotFoundError('Advance not found')

  const receiptNumber = await generateDocumentNumber(req.tenantId!, 'RECEIPT')
  const [tenant, branch, customer, vehicle, visit, booking, estimate] = await Promise.all([
    Tenant.findById(advance.tenantId).lean(),
    Branch.findById(advance.branchId).lean(),
    Customer.findById(advance.customerId).lean(),
    Vehicle.findById(advance.vehicleId).lean(),
    ServiceVisit.findById(advance.serviceVisitId).lean(),
    advance.bookingId ? Booking.findById(advance.bookingId).lean() : null,
    advance.estimateId ? Estimate.findById(advance.estimateId).lean() : null,
  ])

  const snapshot = {
    receiptNumber,
    amount: advance.receivedAmount,
    mode: advance.paymentMode,
    customerName: customer?.name,
    registrationNo: vehicle?.registrationNo,
  }

  const receipt = await Receipt.create({
    tenantId: advance.tenantId,
    branchId: advance.branchId,
    advancePaymentId: advance._id,
    receiptNumber,
    documentType: 'ADVANCE_PAYMENT_RECEIPT',
    documentSnapshot: snapshot,
    issuedAt: new Date(),
    issuedBy: req.user?.id,
  })

  void snapshot
  void tenant
  void branch
  void visit
  void booking
  void estimate

  return receipt
}

export async function getReceiptPdf(req: Request, receiptId: string) {
  const receipt = await Receipt.findOne({ _id: receiptId, tenantId: req.tenantId! }).lean()
  if (!receipt) throw new NotFoundError('Receipt not found')
  const advance = await AdvancePayment.findById(receipt.advancePaymentId).lean()
  if (!advance) throw new NotFoundError('Payment not found')
  if (advance.verificationStatus !== 'CONFIRMED') {
    throw new ValidationError('Receipt available only for confirmed payments')
  }

  const [tenant, branch, customer, vehicle, visit, booking, estimate] = await Promise.all([
    Tenant.findById(receipt.tenantId).lean(),
    Branch.findById(receipt.branchId).lean(),
    Customer.findById(advance.customerId).lean(),
    Vehicle.findById(advance.vehicleId).lean(),
    ServiceVisit.findById(advance.serviceVisitId).lean(),
    advance.bookingId ? Booking.findById(advance.bookingId).lean() : null,
    advance.estimateId ? Estimate.findById(advance.estimateId).lean() : null,
  ])

  const buffer = await generateReceiptPdfBuffer({
    tenantName: tenant?.name ?? 'Workshop',
    legalName: tenant?.legalName ?? undefined,
    branchName: branch?.name ?? '',
    branchAddress: [branch?.address, branch?.city, branch?.state].filter(Boolean).join(', '),
    gstin: tenant?.gstin ?? undefined,
    phone: branch?.phone ?? undefined,
    receiptNumber: receipt.receiptNumber,
    receiptDate: (receipt.issuedAt ?? new Date()).toISOString().slice(0, 10),
    customerName: customer?.name ?? 'Customer',
    customerMobile: customer?.mobile ?? undefined,
    customerAddress: customer?.address ?? undefined,
    registrationNo: vehicle?.registrationNo ?? '—',
    vehicleMakeModel: `${vehicle?.make ?? ''} ${vehicle?.model ?? ''}`.trim(),
    bookingReference: booking?.bookingNumber ?? undefined,
    visitReference: visit?.visitNumber ?? undefined,
    estimateReference: estimate?.estimateNumber ?? undefined,
    estimateRevision: advance.estimateRevisionNumber ?? undefined,
    amountReceived: advance.receivedAmount,
    amountInWords: '',
    paymentMode: advance.paymentMode,
    transactionReference: advance.bankUpiReference ?? advance.paymentReference ?? undefined,
    paymentStatus: advance.verificationStatus,
    remarks: advance.remarks ?? undefined,
  })

  return { buffer, filename: `${receipt.receiptNumber}.pdf` }
}

export async function sendReceiptEmail(req: Request, receiptId: string, recipient: string) {
  const { buffer, filename } = await getReceiptPdf(req, receiptId)
  const receipt = await Receipt.findOne({ _id: receiptId, tenantId: req.tenantId! }).lean()
  const result = await sendTransactionalEmail({
    to: recipient,
    subject: `Payment receipt ${receipt?.receiptNumber ?? ''}`,
    text: `Please find attached receipt ${receipt?.receiptNumber ?? ''}.`,
    attachment: { filename, content: buffer, contentType: 'application/pdf' },
  })
  const comm = await ReceiptCommunication.create({
    tenantId: req.tenantId!,
    receiptId,
    channel: 'EMAIL',
    recipient,
    status: result.status === 'SENT' ? 'SENT' : 'FAILED',
    providerReference: result.providerReference,
    errorDetails: result.errorDetails,
  })
  return { communicationId: comm._id.toString(), status: comm.status, message: comm.errorDetails ?? result.providerReference }
}

export async function sendReceiptWhatsApp(req: Request, receiptId: string, recipient: string) {
  const receipt = await Receipt.findOne({ _id: receiptId, tenantId: req.tenantId! }).lean()
  const result = await sendWhatsAppNotify({
    to: recipient,
    body: `Advance receipt ${receipt?.receiptNumber ?? ''} from ZentroSure.`,
  })
  const comm = await ReceiptCommunication.create({
    tenantId: req.tenantId!,
    receiptId,
    channel: 'WHATSAPP',
    recipient,
    status: result.status === 'SENT' ? 'SENT' : 'FAILED',
    providerReference: result.providerReference,
    errorDetails: result.status === 'NOT_CONFIGURED' ? `NOT_CONFIGURED: ${result.errorDetails}` : result.errorDetails,
  })
  return { communicationId: comm._id.toString(), status: comm.status, message: comm.errorDetails ?? result.providerReference }
}

export async function reverseAdvance(req: Request, id: string, reason: string) {
  if (!req.user?.permissions.includes('payments.reverse') && !req.user?.permissions.includes('billing.create')) {
    throw new ForbiddenError('Finance permission required for reversal')
  }
  const advance = await AdvancePayment.findOne({ _id: id, ...tenantFilter(req) })
  if (!advance) throw new NotFoundError('Advance not found')
  if (advance.verificationStatus !== 'CONFIRMED') {
    throw new ValidationError('Only confirmed payments can be reversed')
  }
  advance.verificationStatus = 'CANCELLED'
  advance.reversedAt = new Date()
  advance.reversedBy = req.user?.id as unknown as typeof advance.reversedBy
  advance.reversalReason = reason
  await advance.save()
  await evaluateFinancialAuthorization(req, advance.serviceVisitId.toString())
  await createAuditLog({ req, module: 'payments', action: 'ADVANCE_REVERSED', recordId: id, newValue: { reason } })
  return advance
}
