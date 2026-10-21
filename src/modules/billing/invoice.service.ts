import type { Request } from 'express'
import { createHash } from 'node:crypto'
import {
  AdvancePayment,
  Branch,
  Customer,
  FinalInvoice,
  GatePass,
  InvoiceAllocation,
  InvoiceAcknowledgment,
  InvoiceCommunication,
  InvoicePayment,
  Booking,
  JobCard,
  JobWorkItem,
  Media,
  QCAttempt,
  QualityControlCase,
  ServiceVisit,
  Tenant,
  Vehicle,
  VehicleDelivery,
  VocRecord,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { assertEligibleForInvoice, financialYearIndia } from './billing-eligibility.js'
import { roundMoney } from '../estimates/estimate-calculation.js'
import { generateInvoicePdfBuffer } from './invoice-pdf.service.js'
import { generateRepairReportPdfBuffer } from './repair-report-pdf.service.js'
import { buildInvoiceDraftPayload } from './invoice-draft-builder.js'
import { assertReconciliationAllowsIssue, buildReconciliationSummary } from './invoice-reconciliation.service.js'
import { requireTaxRuleForInvoiceLine } from '../tax/tax-resolution.js'
import { sendTransactionalEmail, sendWhatsAppNotify } from '../../utils/outbound-notify.js'
import { computeCreditExposure } from '../approvals/approval-policy.service.js'
import { assertEInvoiceReadyForIssue } from '../e-invoice/e-invoice.service.js'
import { mapFinalInvoiceToEInvoicePayload } from '../e-invoice/e-invoice-payload.js'
import { computeInvoiceBalanceDue } from './ar-receivables.service.js'
import { onInvoiceIssued } from '../workflow/workflow-engine.service.js'
import { listPaymentRequestsForInvoice } from '../payments/razorpay-payment.service.js'
import type { Types } from 'mongoose'

async function resolveUseIgst(tenantId: string, branchId: Types.ObjectId, customer: { state?: string | null }) {
  const branch = await Branch.findById(branchId).lean()
  const branchState = (branch?.state ?? '').toUpperCase()
  const custState = (customer.state ?? '').toUpperCase()
  if (!branchState || !custState) return false
  return branchState !== custState
}

export async function createDraftFromVisit(req: Request, visitId: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const dup = await FinalInvoice.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return { invoice: dup, duplicate: true }
  }

  const eligibility = await assertEligibleForInvoice(req.tenantId!, visitId)
  if (!eligibility.eligible) throw new ValidationError(eligibility.reasons.join('; '))

  const existingDraft = await FinalInvoice.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId, status: 'DRAFT' })
  if (existingDraft) return { invoice: existingDraft, duplicate: true }

  const visit = eligibility.visit!
  const jc = eligibility.jobCard!
  const qc = eligibility.qcCase
  const customer = await Customer.findById(visit.customerId).lean()
  const vehicle = await Vehicle.findById(visit.vehicleId).lean()
  const tenant = await Tenant.findById(req.tenantId!).lean()
  const branch = await Branch.findById(visit.branchId).lean()
  if (!customer || !vehicle) throw new NotFoundError('Customer or vehicle missing')

  const useIgst = await resolveUseIgst(req.tenantId!, visit.branchId, customer)
  let draftPayload
  try {
    draftPayload = await buildInvoiceDraftPayload({
      tenantId: req.tenantId!,
      serviceVisitId: visitId,
      jobCardId: jc._id,
      jobCardRevision: jc.revisionNumber ?? 1,
      useIgst,
    })
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : 'Draft build failed')
  }
  const { lines, totals, reconciliation } = draftPayload

  const invoiceNumber = await generateDocumentNumber(req.tenantId!, 'FINAL_INVOICE')
  const invoice = await FinalInvoice.create({
    tenantId: req.tenantId!,
    branchId: visit.branchId,
    serviceVisitId: visit._id,
    jobCardId: jc._id,
    qcCaseId: qc?._id,
    customerId: customer._id,
    vehicleId: vehicle._id,
    invoiceNumber,
    financialYear: financialYearIndia(),
    jobCardRevisionNumber: jc.revisionNumber ?? 1,
    qcReference: qc?.qcReference,
    customerSnapshot: {
      name: customer.name,
      mobile: customer.mobile,
      email: customer.email,
      address: customer.address,
      state: customer.state,
      gstin: customer.gstin,
    },
    vehicleSnapshot: {
      registrationNo: vehicle.registrationNo,
      make: vehicle.make,
      model: vehicle.model,
      fuelType: vehicle.fuelType,
      gateInOdometer: visit.odometer,
      finalQcOdometer: visit.finalQcOdometer,
    },
    supplierSnapshot: {
      legalName: tenant?.legalName ?? tenant?.name,
      gstin: tenant?.gstin ?? undefined,
      branchAddress: branch?.address,
      state: branch?.state,
    },
    placeOfSupply: customer.state ?? branch?.state,
    lines,
    reconciliationLines: reconciliation.lines,
    reconciliationBlocking: reconciliation.hasBlocking,
    taxSummary: {
      labourSubtotal: totals.labourSubtotal,
      partsSubtotal: totals.partsSubtotal,
      grossValue: totals.grossAmount,
      discountTotal: totals.totalDiscount,
      taxableValue: totals.taxableAmount,
      cgstTotal: totals.cgst,
      sgstTotal: totals.sgst,
      igstTotal: totals.igst,
      roundingAdjustment: totals.roundingAdjustment,
      grandTotal: totals.finalAmount,
    },
    grandTotal: totals.finalAmount,
    balanceDue: totals.finalAmount,
    status: 'DRAFT',
    paymentStatus: 'UNPAID',
    createdBy: req.user?.id,
    idempotencyKey,
  })

  await createAuditLog({ req, module: 'billing', action: 'DRAFT_CREATED', recordId: invoice._id.toString() })
  return { invoice, duplicate: false }
}

export async function issueInvoice(req: Request, invoiceId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId! })
  if (!inv) throw new NotFoundError('Invoice not found')
  if (inv.status === 'ISSUED') return { invoice: inv, duplicate: true }
  if (inv.status !== 'DRAFT') throw new ValidationError('Only draft invoices can be issued')

  const reconciliation = await buildReconciliationSummary(
    req.tenantId!,
    inv.serviceVisitId.toString(),
    inv.jobCardId,
    (inv.reconciliationOverrides ?? {}) as Record<string, { varianceReason?: string; authorizedException?: boolean }>,
  )
  await assertReconciliationAllowsIssue(reconciliation)
  if (inv.reconciliationBlocking) {
    throw new ValidationError('Reconciliation discrepancies must be resolved before issue')
  }
  for (const line of inv.lines ?? []) {
    if (line.reconciliationStatus === 'BLOCKING') {
      throw new ValidationError(`Blocking line: ${line.description}`)
    }
    await requireTaxRuleForInvoiceLine(req.tenantId!, line.category ?? 'OTHER', line.hsnSac)
    if (!line.taxRuleId) throw new ValidationError(`Tax rule missing on line ${line.description}`)
  }

  const advances = await AdvancePayment.find({
    tenantId: req.tenantId!,
    serviceVisitId: inv.serviceVisitId,
    verificationStatus: 'CONFIRMED',
  })
  let allocated = 0
  for (const adv of advances) {
    const already = await InvoiceAllocation.findOne({ tenantId: req.tenantId!, invoiceId: inv._id, sourcePaymentId: adv._id })
    if (already) continue
    const remaining = (adv.receivedAmount ?? 0) - (adv.allocationAmount ?? 0)
    if (remaining <= 0) continue
    const apply = Math.min(remaining, inv.grandTotal - allocated)
    if (apply <= 0) break
    await InvoiceAllocation.create({
      tenantId: req.tenantId!,
      invoiceId: inv._id,
      sourcePaymentId: adv._id,
      amount: apply,
      allocationType: 'ADVANCE',
      allocatedBy: req.user?.id,
    })
    adv.allocationAmount = (adv.allocationAmount ?? 0) + apply
    await adv.save()
    allocated = roundMoney(allocated + apply)
  }

  inv.advanceAllocated = allocated
  inv.paymentsReceived = 0
  inv.creditsApplied = inv.creditsApplied ?? 0
  inv.balanceDue = computeInvoiceBalanceDue({
    grandTotal: inv.grandTotal ?? 0,
    advanceAllocated: allocated,
    paymentsReceived: 0,
    creditsApplied: inv.creditsApplied,
  })
  inv.paymentStatus = inv.balanceDue <= 0 ? 'PAID' : allocated > 0 ? 'PARTIALLY_PAID' : 'UNPAID'
  inv.issuedAt = new Date()
  inv.issuedBy = req.user?.id as unknown as typeof inv.issuedBy
  inv.issuedSnapshotHash = createHash('sha256').update(JSON.stringify(inv.lines)).digest('hex')

  const einvPrep = await assertEInvoiceReadyForIssue(req.tenantId!, inv)
  if (einvPrep.required && einvPrep.provider) {
    const payload = mapFinalInvoiceToEInvoicePayload(inv.toObject() as Parameters<typeof mapFinalInvoiceToEInvoicePayload>[0])
    inv.set('eInvoice', { eligibility: 'REQUIRED', irnStatus: 'PENDING' })
    const irnResult = await einvPrep.provider.generateIrn(payload)
    if (!irnResult.success || !irnResult.irn) {
      throw new ValidationError(
        irnResult.errorMessage ??
          'E-invoice IRN generation failed — invoice not issued. Configure authorized GSP credentials.',
      )
    }
    inv.set('eInvoice', {
      eligibility: 'REQUIRED',
      irnStatus: 'GENERATED',
      irn: irnResult.irn,
      ackNo: irnResult.ackNo,
      ackDate: irnResult.ackDate,
      signedQrCode: irnResult.signedQrCode,
      providerReference: irnResult.providerReference,
    })
  } else {
    inv.set('eInvoice', {
      eligibility: einvPrep.assessment.requirement,
      irnStatus: 'NOT_REQUIRED',
    })
  }

  inv.status = 'ISSUED'
  await inv.save()

  await createAuditLog({ req, module: 'billing', action: 'ISSUED', recordId: invoiceId })
  await onInvoiceIssued(req, inv.serviceVisitId.toString())
  await ServiceVisit.updateOne(
    { _id: inv.serviceVisitId, tenantId: req.tenantId! },
    { $set: { outstanding: inv.balanceDue } },
  )
  return { invoice: inv, duplicate: false }
}

export async function collectPayment(req: Request, body: Record<string, unknown>) {
  const idempotencyKey = body.idempotencyKey as string | undefined
  if (idempotencyKey) {
    const dup = await InvoicePayment.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return dup
  }
  const invoiceId = String(body.invoiceId)
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new NotFoundError('Issued invoice not found')
  const amount = Number(body.amount)
  if (!amount || amount <= 0) throw new ValidationError('Invalid amount')
  if (amount > inv.balanceDue + 0.01) throw new ValidationError('Amount exceeds balance due')

  const receiptNumber = await generateDocumentNumber(req.tenantId!, 'INVOICE_PAYMENT')
  const payment = await InvoicePayment.create({
    tenantId: req.tenantId!,
    branchId: inv.branchId,
    invoiceId: inv._id,
    customerId: inv.customerId,
    serviceVisitId: inv.serviceVisitId,
    receiptNumber,
    amount,
    paymentMethod: String(body.paymentMethod ?? 'CASH'),
    transactionReference: body.transactionReference as string,
    verificationStatus: body.paymentMethod === 'CASH' ? 'PENDING_VERIFICATION' : 'PENDING_VERIFICATION',
    collectedBy: req.user?.id,
    remarks: body.remarks as string,
    idempotencyKey,
  })
  return payment
}

export async function verifyInvoicePayment(req: Request, paymentId: string) {
  const pay = await InvoicePayment.findOne({ _id: paymentId, tenantId: req.tenantId! })
  if (!pay) throw new NotFoundError('Payment not found')
  if (pay.verificationStatus === 'VERIFIED') return pay

  pay.verificationStatus = 'VERIFIED'
  pay.verifiedAt = new Date()
  pay.verifiedBy = req.user?.id as unknown as typeof pay.verifiedBy
  await pay.save()

  const inv = await FinalInvoice.findById(pay.invoiceId)
  if (!inv) throw new NotFoundError('Invoice missing')

  await InvoiceAllocation.create({
    tenantId: req.tenantId!,
    invoiceId: inv._id,
    invoicePaymentId: pay._id,
    amount: pay.amount,
    allocationType: 'PAYMENT',
    allocatedBy: req.user?.id,
  })

  inv.paymentsReceived = roundMoney((inv.paymentsReceived ?? 0) + pay.amount)
  inv.balanceDue = computeInvoiceBalanceDue({
    grandTotal: inv.grandTotal ?? 0,
    advanceAllocated: inv.advanceAllocated,
    paymentsReceived: inv.paymentsReceived,
    creditsApplied: inv.creditsApplied,
  })
  inv.paymentStatus = inv.balanceDue <= 0 ? 'PAID' : 'PARTIALLY_PAID'
  await inv.save()
  const { onInvoiceSettlementChanged } = await import('../workflow/workflow-engine.service.js')
  await onInvoiceSettlementChanged(
    req,
    req.tenantId!,
    inv.serviceVisitId.toString(),
    inv.balanceDue ?? 0,
    inv.paymentStatus ?? 'UNPAID',
  )
  return pay
}

export async function authorizeCreditClearance(req: Request, invoiceId: string, body: { remarks?: string }) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new NotFoundError('Issued invoice required')
  const exposure = await computeCreditExposure(req.tenantId!, inv.customerId, inv.balanceDue)
  if (!exposure.creditAllowed) {
    throw new ValidationError('Customer credit not authorized or on hold')
  }
  if (exposure.availableCredit < inv.balanceDue - 0.01) {
    throw new ValidationError(`Credit limit exceeded. Available: ${exposure.availableCredit}, required: ${inv.balanceDue}`)
  }
  inv.creditClearanceAuthorized = true
  inv.creditClearanceBy = req.user?.id as unknown as typeof inv.creditClearanceBy
  inv.creditClearanceAt = new Date()
  if (inv.balanceDue > 0) inv.paymentStatus = 'CREDIT_AUTHORIZED'
  await inv.save()
  await createAuditLog({ req, module: 'billing', action: 'CREDIT_CLEARANCE', recordId: invoiceId, newValue: body })
  return inv
}

export async function getInvoicePdf(req: Request, invoiceId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId! }).lean()
  if (!inv || inv.status !== 'ISSUED') throw new ValidationError('Issued invoice required for PDF')
  const tenant = await Tenant.findById(req.tenantId!).lean()
  const branch = await Branch.findById(inv.branchId).lean()
  const jc = await JobCard.findById(inv.jobCardId).lean()
  const snap = inv.customerSnapshot as { name?: string; mobile?: string; address?: string; gstin?: string }
  const vs = inv.vehicleSnapshot as { registrationNo?: string; make?: string; model?: string }

  return generateInvoicePdfBuffer({
    tenantName: tenant?.name ?? 'Workshop',
    branchName: branch?.name ?? '',
    gstin: tenant?.gstin ?? undefined,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : '',
    customerName: snap?.name ?? '',
    customerAddress: snap?.address,
    customerMobile: snap?.mobile,
    customerGstin: snap?.gstin,
    registrationNo: vs?.registrationNo ?? '',
    vehicleMakeModel: [vs?.make, vs?.model].filter(Boolean).join(' '),
    jobCardNumber: jc?.jobCardNumber ?? '',
    qcReference: inv.qcReference ?? undefined,
    lines: (inv.lines ?? []).map((l) => ({
      description: l.description ?? '',
      hsnSac: l.hsnSac ?? undefined,
      qty: l.quantity ?? 1,
      rate: l.unitRate ?? 0,
      taxable: l.taxableAmount ?? 0,
      tax: (l.cgstAmount ?? 0) + (l.sgstAmount ?? 0) + (l.igstAmount ?? 0),
      total: l.finalAmount ?? 0,
    })),
    taxSummary: {
      taxableValue: inv.taxSummary?.taxableValue ?? 0,
      cgst: inv.taxSummary?.cgstTotal ?? 0,
      sgst: inv.taxSummary?.sgstTotal ?? 0,
      igst: inv.taxSummary?.igstTotal ?? 0,
      grandTotal: inv.grandTotal ?? 0,
    },
    advanceAllocated: inv.advanceAllocated ?? 0,
    paymentsReceived: inv.paymentsReceived ?? 0,
    balanceDue: inv.balanceDue ?? 0,
  })
}

export async function recordCommunication(req: Request, invoiceId: string, channel: 'EMAIL' | 'WHATSAPP', recipient: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new ValidationError('Issued invoice required for customer communication')

  const pdf = await getInvoicePdf(req, invoiceId)
  const snap = inv.customerSnapshot as { name?: string }
  const subject = `Tax Invoice ${inv.invoiceNumber} — ${snap?.name ?? 'Customer'}`
  const text = `Invoice ${inv.invoiceNumber} for ₹${inv.grandTotal}. Balance due: ₹${inv.balanceDue}.`

  let result
  if (channel === 'EMAIL') {
    result = await sendTransactionalEmail({
      to: recipient,
      subject,
      text,
      attachment: { filename: `${inv.invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' },
    })
  } else {
    const base = process.env.PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? ''
    const link = base ? `${base}/api/v1/billing/invoices/${invoiceId}/pdf` : '(configure PUBLIC_APP_URL for secure links)'
    result = await sendWhatsAppNotify({
      to: recipient,
      body: `${text} View: ${link}`,
    })
  }

  const status = result.status === 'SENT' ? 'SENT' : 'FAILED'
  return InvoiceCommunication.create({
    tenantId: req.tenantId!,
    invoiceId,
    channel,
    recipient,
    status,
    providerReference: result.providerReference,
    errorDetails: result.status === 'NOT_CONFIGURED'
      ? `NOT_CONFIGURED: ${result.errorDetails ?? 'Provider not configured'}`
      : result.errorDetails,
  })
}

export async function acknowledgeInvoice(req: Request, invoiceId: string, body: Record<string, unknown>) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new NotFoundError('Invoice not found')
  return InvoiceAcknowledgment.create({
    tenantId: req.tenantId!,
    invoiceId: inv._id,
    customerId: inv.customerId,
    acknowledgmentType: body.acknowledgmentType ?? 'VIEWED',
    verifiedContact: body.verifiedContact as string,
    verificationMethod: body.verificationMethod as string,
    remarks: body.remarks as string,
  })
}

export async function getInvoice(req: Request, invoiceId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId! }).lean()
  if (!inv) throw new NotFoundError('Invoice not found')
  const payments = await InvoicePayment.find({ invoiceId: inv._id }).lean()
  const allocations = await InvoiceAllocation.find({ invoiceId: inv._id }).lean()
  return { invoice: inv, payments, allocations }
}

export async function getVisitReconciliation(req: Request, visitId: string) {
  const jc = await JobCard.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean()
  if (!jc) throw new NotFoundError('Job card not found')
  const draft = await FinalInvoice.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId, status: 'DRAFT' }).lean()
  const overrides = (draft?.reconciliationOverrides ?? {}) as Record<string, { varianceReason?: string; authorizedException?: boolean }>
  return buildReconciliationSummary(req.tenantId!, visitId, jc._id, overrides)
}

export async function resolveReconciliationDiscrepancy(
  req: Request,
  visitId: string,
  body: { lineKey: string; varianceReason?: string; authorizedException?: boolean },
) {
  const draft = await FinalInvoice.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId, status: 'DRAFT' })
  if (!draft) throw new ValidationError('Draft invoice required to resolve reconciliation')
  const jc = await JobCard.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId })
  if (!jc) throw new NotFoundError('Job card not found')
  const customer = await Customer.findById(draft.customerId).lean()
  const useIgst = customer ? await resolveUseIgst(req.tenantId!, draft.branchId, customer) : false
  const overrides = { ...(draft.reconciliationOverrides as object), [body.lineKey]: {
    varianceReason: body.varianceReason,
    authorizedException: body.authorizedException === true,
  } }
  const payload = await buildInvoiceDraftPayload({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
    jobCardId: jc._id,
    jobCardRevision: jc.revisionNumber ?? 1,
    useIgst,
    reconciliationOverrides: overrides,
  })
  draft.reconciliationOverrides = overrides
  draft.set('lines', payload.lines)
  draft.set('reconciliationLines', payload.reconciliation.lines)
  draft.reconciliationBlocking = payload.reconciliation.hasBlocking
  draft.taxSummary = {
    labourSubtotal: payload.totals.labourSubtotal,
    partsSubtotal: payload.totals.partsSubtotal,
    grossValue: payload.totals.grossAmount,
    discountTotal: payload.totals.totalDiscount,
    taxableValue: payload.totals.taxableAmount,
    cgstTotal: payload.totals.cgst,
    sgstTotal: payload.totals.sgst,
    igstTotal: payload.totals.igst,
    roundingAdjustment: payload.totals.roundingAdjustment,
    grandTotal: payload.totals.finalAmount,
  }
  draft.grandTotal = payload.totals.finalAmount
  draft.balanceDue = payload.totals.finalAmount
  await draft.save()
  await createAuditLog({ req, module: 'billing', action: 'RECONCILIATION_RESOLVED', recordId: draft._id.toString(), newValue: body })
  return { invoice: draft, reconciliation: payload.reconciliation }
}

export async function getRepairReportPdf(req: Request, invoiceId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' }).lean()
  if (!inv) throw new ValidationError('Issued invoice required for repair report')
  const tenant = await Tenant.findById(req.tenantId!).lean()
  const jc = await JobCard.findById(inv.jobCardId).lean()
  const qc = await QualityControlCase.findOne({ tenantId: req.tenantId!, serviceVisitId: inv.serviceVisitId }).lean()
  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId: inv.serviceVisitId }).lean()
  const booking = await Booking.findOne({ tenantId: req.tenantId!, serviceVisitId: inv.serviceVisitId }).lean()
  const snap = inv.customerSnapshot as { name?: string }
  const vs = inv.vehicleSnapshot as { registrationNo?: string; make?: string; model?: string }

  const entityIds = [
    inv.serviceVisitId.toString(),
    inv.jobCardId.toString(),
    qc?._id?.toString(),
  ].filter(Boolean) as string[]
  const media = await Media.find({
    tenantId: req.tenantId!,
    entityId: { $in: entityIds },
  }).limit(40).lean()

  const toSlot = (m: { remarks?: string | null; url?: string; publicId?: string; imageCategory?: string | null }) => ({
    caption: m.remarks ?? m.imageCategory ?? undefined,
    url: m.url,
    publicId: m.publicId,
  })
  const byCat = (cats: string[]) =>
    media.filter((m) => m.imageCategory && cats.includes(m.imageCategory)).map(toSlot)

  const imageSections = [
    { title: 'Gate-In & receiving condition', images: byCat(['GATE_IN', 'INVENTORY', 'DAMAGE', 'ODOMETER']) },
    { title: 'Before repair', images: byCat(['QC_BEFORE', 'INSPECTION', 'FINDING', 'TRIAL']).concat(
      media.filter((m) => m.tags?.includes('before')).map(toSlot),
    ) },
    { title: 'During repair', images: byCat(['WIP_EVIDENCE', 'REWORK', 'DIAGNOSTIC']) },
    { title: 'After repair', images: byCat(['QC_AFTER']).concat(media.filter((m) => m.tags?.includes('after')).map(toSlot)) },
    { title: 'QC & road test evidence', images: byCat(['QC_DEFECT', 'ROAD_TEST', 'VOC']) },
  ]

  const attempt = qc?.currentAttemptId ? await QCAttempt.findById(qc.currentAttemptId).lean() : null

  const vocComplaints = (voc?.complaints ?? []).map((c: { description?: string }) => c.description ?? '').filter(Boolean)
  const workItems = await JobWorkItem.find({ tenantId: req.tenantId!, jobCardId: inv.jobCardId }).lean()
  const completedWork = workItems
    .filter((w) => w.status === 'COMPLETED')
    .map((w) => w.description ?? '')
  const partsReplaced = (inv.lines ?? [])
    .filter((l) => l.category === 'PARTS')
    .map((l) => `${l.partNumber ?? ''} ${l.description} x${l.billableQuantity ?? l.quantity}`)

  return generateRepairReportPdfBuffer({
    tenantName: tenant?.legalName ?? tenant?.name ?? 'Workshop',
    customerName: snap?.name ?? '',
    registrationNo: vs?.registrationNo ?? '',
    vehicleMakeModel: [vs?.make, vs?.model].filter(Boolean).join(' '),
    bookingReference: booking?.bookingNumber,
    jobCardNumber: jc?.jobCardNumber ?? '',
    jobCardRevision: inv.jobCardRevisionNumber ?? undefined,
    qcReference: inv.qcReference ?? undefined,
    qcStatus: qc?.status,
    roadTestStatus: attempt?.roadTest?.finalResult,
    vocComplaints,
    diagnosisFindings: (attempt?.workChecks ?? [])
      .filter((i) => i.result === 'FAIL' || i.result === 'ATTENTION')
      .map((i) => {
        const row = i as { label?: string; checkId?: string; remarks?: string }
        return `${row.label ?? row.checkId ?? 'Check'}: ${row.remarks ?? ''}`
      }),
    completedWork,
    partsReplaced,
    inspectorRemarks: attempt?.inspectorFeedback?.inspectorRemarks ?? undefined,
    advisories: (attempt?.inspectorFeedback?.minorObservations ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    imageSections,
  })
}

export async function getVisitBillingWorkspace(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! }).lean()
  if (!visit) throw new NotFoundError('Service visit not found')
  const customer = await Customer.findById(visit.customerId).lean()
  const vehicle = await Vehicle.findById(visit.vehicleId).lean()
  const jobCard = await JobCard.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean()
  const qcCase = await QualityControlCase.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean()
  const invoice = await FinalInvoice.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId })
    .sort({ createdAt: -1 })
    .lean()
  const gatePass = invoice
    ? await GatePass.findOne({ tenantId: req.tenantId!, invoiceId: invoice._id, status: { $ne: 'VOID' } })
        .sort({ createdAt: -1 })
        .lean()
    : null
  const delivery = gatePass
    ? await VehicleDelivery.findOne({ tenantId: req.tenantId!, gatePassId: gatePass._id }).lean()
    : null
  let payments: unknown[] = []
  let allocations: unknown[] = []
  if (invoice) {
    payments = await InvoicePayment.find({ invoiceId: invoice._id }).lean()
    allocations = await InvoiceAllocation.find({ invoiceId: invoice._id }).lean()
  }
  const eligibility = await assertEligibleForInvoice(req.tenantId!, visitId)
  let reconciliation = null
  if (jobCard) {
    try {
      reconciliation = await getVisitReconciliation(req, visitId)
    } catch {
      reconciliation = null
    }
  }
  const communications = invoice
    ? await InvoiceCommunication.find({ tenantId: req.tenantId!, invoiceId: invoice._id }).sort({ createdAt: -1 }).limit(10).lean()
    : []
  const paymentRequests = invoice
    ? await listPaymentRequestsForInvoice(req.tenantId!, invoice._id.toString())
    : []
  return {
    visitId,
    visit,
    customer,
    vehicle,
    jobCard,
    qcCase,
    invoice,
    gatePass,
    delivery,
    payments,
    allocations,
    communications,
    paymentRequests,
    reconciliation,
    eligibility,
  }
}
