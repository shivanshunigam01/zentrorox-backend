import { randomUUID } from 'node:crypto'
import {
  Booking,
  Branch,
  Customer,
  DiscountPolicy,
  Estimate,
  EstimateCommunication,
  InspectionCase,
  Part,
  ServiceVisit,
  StockBalance,
  TaxRule,
  Tenant,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { createAuditLog } from '../../utils/audit.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'
import type { Request } from 'express'
import { assertEligibleForEstimate, assertVisitEligibleForEstimate, loadEstimateEligibilityContext } from './estimate-eligibility.js'
import { calculateEstimateTotals, calculateLine, type CalcLineOutput } from './estimate-calculation.js'
import { generateEstimatePdfBuffer } from './estimate-pdf.service.js'
import { sendTransactionalEmail } from '../../utils/outbound-notify.js'
import type { Types } from 'mongoose'

export type EstimateTotals = ReturnType<typeof calculateEstimateTotals>

function tenantFilter(req: Request) {
  return {
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }
}

async function resolveTaxRule(tenantId: string, hsnSac?: string, at = new Date()) {
  const rules = await TaxRule.find({
    tenantId,
    active: true,
    approvalStatus: 'APPROVED',
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at } }],
    ...(hsnSac && { hsnSac }),
  }).sort({ effectiveFrom: -1 }).limit(1).lean()
  if (!rules.length && hsnSac) {
    const fallback = await TaxRule.findOne({
      tenantId,
      active: true,
      approvalStatus: 'APPROVED',
      effectiveFrom: { $lte: at },
      $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at } }],
    }).sort({ effectiveFrom: -1 }).lean()
    return fallback
  }
  return rules[0] ?? null
}

async function useIgstForVisit(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! }).populate('customerId').lean()
  const branch = req.branchId
    ? await Branch.findOne({ _id: req.branchId, tenantId: req.tenantId! }).lean()
    : null
  const customer = visit?.customerId as { state?: string } | undefined
  if (!branch?.state || !customer?.state) return false
  return branch.state.toLowerCase() !== customer.state.toLowerCase()
}

export async function recalculateRevision(
  req: Request,
  items: Array<Record<string, unknown>>,
  visitId: string,
) {
  const useIgst = await useIgstForVisit(req, visitId)
  const calcLines: CalcLineOutput[] = []
  for (const raw of items) {
    const hsnSac = raw.hsnSac as string | undefined
    const taxRuleDoc = await resolveTaxRule(req.tenantId!, hsnSac)
    if (!taxRuleDoc && raw.category !== 'OTHER') {
      throw new ValidationError(`No approved tax rule for HSN/SAC ${hsnSac ?? '(missing)'}`)
    }
    const taxRule = taxRuleDoc
      ? {
          id: taxRuleDoc._id.toString(),
          gstPercent: taxRuleDoc.gstPercent,
          cgstPercent: taxRuleDoc.cgstPercent ?? taxRuleDoc.gstPercent / 2,
          sgstPercent: taxRuleDoc.sgstPercent ?? taxRuleDoc.gstPercent / 2,
          igstPercent: taxRuleDoc.igstPercent ?? taxRuleDoc.gstPercent,
          taxInclusive: taxRuleDoc.taxInclusive,
        }
      : undefined
    if (!taxRule) {
      throw new ValidationError('Tax classification required for estimate line')
    }
    calcLines.push(
      calculateLine({
        lineId: String(raw.lineId ?? randomUUID()),
        category: String(raw.category),
        quantity: Number(raw.quantity ?? 1),
        unitRate: Number(raw.unitRate ?? 0),
        labourHours: raw.labourHours != null ? Number(raw.labourHours) : undefined,
        labourRate: raw.labourRate != null ? Number(raw.labourRate) : undefined,
        discountAmount: Number(raw.discountAmount ?? 0),
        useIgst,
        taxRule,
      }),
    )
  }
  const totals = calculateEstimateTotals(calcLines)
  const merged = calcLines.map((c, i) => ({
    ...items[i],
    ...c,
    taxRuleId: c.taxRule?.id,
  }))
  return { items: merged, totals }
}

export async function syncEstimateQueue(req: Request) {
  const tenantId = req.tenantId!
  const inspections = await InspectionCase.find({
    tenantId,
    ...(req.branchId && { branchId: req.branchId }),
    status: 'COMPLETED',
  }).select('serviceVisitId').lean()

  let created = 0
  for (const insp of inspections) {
    const exists = await Estimate.findOne({ tenantId, serviceVisitId: insp.serviceVisitId })
    if (exists) continue
    try {
      await createFromInspectionCase(req, insp._id.toString())
      created++
    } catch {
      // not yet eligible
    }
  }
  return created
}

export async function createFromInspectionCase(req: Request, inspectionCaseId: string) {
  const tenantId = req.tenantId!
  const inspection = await InspectionCase.findOne({ _id: inspectionCaseId, tenantId })
  if (!inspection) throw new NotFoundError('Inspection case not found')
  if (inspection.status !== 'COMPLETED') {
    throw new ValidationError('Inspection must be completed before creating estimate')
  }

  const visitId = inspection.serviceVisitId.toString()
  const existing = await Estimate.findOne({ tenantId, serviceVisitId: visitId })
  if (existing) return mapEstimate(existing)

  await assertVisitEligibleForEstimate(req, visitId)

  const visit = await ServiceVisit.findById(visitId)
  if (!visit) throw new NotFoundError('Service visit not found')

  const branch = await Branch.findOne({ _id: visit.branchId, tenantId }).lean()
  const estimateNumber = await generateDocumentNumber(tenantId, 'ESTIMATE', branch?.code)

  const draftItems = (inspection.findings ?? []).map((f) => ({
    lineId: randomUUID(),
    category: 'LABOUR',
    itemCode: 'FROM_FINDING',
    description: String((f as { observedFailure?: string }).observedFailure ?? 'Recommended repair'),
    linkedFindingIds: [(f as { _id?: Types.ObjectId })._id?.toString()].filter(Boolean),
    quantity: 1,
    unitRate: 0,
    hsnSac: '998729',
    optional: false,
  }))

  const { items, totals } = draftItems.length
    ? await recalculateRevision(req, draftItems, visitId)
    : { items: [], totals: calculateEstimateTotals([]) }

  const estimate = await Estimate.create({
    tenantId,
    branchId: visit.branchId,
    serviceVisitId: visit._id,
    bookingId: visit.bookingId,
    inspectionCaseId: inspection._id,
    estimateNumber,
    estimateKind: 'PRIMARY',
    status: 'DRAFT',
    currentRevisionNumber: 1,
    assignedAdvisorId: req.user?.id,
    createdBy: req.user?.id,
    validUntil: new Date(Date.now() + 15 * 86400000),
    revisions: [{
      revisionNumber: 1,
      items,
      totals,
      frozen: false,
    }],
  })

  await createAuditLog({
    tenantId,
    userId: req.user?.id,
    module: 'estimates',
    action: 'CREATE',
    recordId: estimate._id.toString(),
    req,
  })

  return mapEstimate(estimate)
}

function mapEstimate(doc: {
  _id: Types.ObjectId
  estimateNumber: string
  status: string
  currentRevisionNumber: number
  serviceVisitId: Types.ObjectId
  version?: number
}) {
  return {
    id: doc._id.toString(),
    estimateNumber: doc.estimateNumber,
    status: doc.status,
    currentRevisionNumber: doc.currentRevisionNumber,
    serviceVisitId: doc.serviceVisitId.toString(),
    version: doc.version ?? 0,
  }
}

function currentRevision(doc: { revisions: Array<{ revisionNumber: number }>; currentRevisionNumber: number }) {
  return doc.revisions.find((r) => r.revisionNumber === doc.currentRevisionNumber) as {
    revisionNumber: number
    frozen?: boolean
    items?: Array<{
      lineId: string
      description: string
      category: string
      hsnSac?: string
      quantity: number
      unitRate: number
      discountAmount?: number
      finalAmount: number
      customerApprovalStatus?: string
      toObject?: () => unknown
    }>
    totals?: EstimateTotals
    issuedAt?: Date
    issuedBy?: Types.ObjectId
  } | undefined
}

export async function getEstimateQueue(req: Request, params: { status?: string; search?: string; page?: number; limit?: number }) {
  await syncEstimateQueue(req)
  const filter = tenantFilter(req) as Record<string, unknown>
  if (params.status) filter.status = params.status

  const visits = await ServiceVisit.find({
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
    currentStage: 'ESTIMATE',
  }).select('_id visitNumber bookingId customerId vehicleId').lean()

  const visitIds = visits.map((v) => v._id)
  const estimates = await Estimate.find({ ...filter, serviceVisitId: { $in: visitIds } })
    .populate('assignedAdvisorId', 'firstName lastName')
    .lean()

  const insp = await InspectionCase.find({ tenantId: req.tenantId!, serviceVisitId: { $in: visitIds } }).lean()
  const inspByVisit = new Map(insp.map((i) => [i.serviceVisitId.toString(), i]))

  const items = []
  for (const v of visits) {
    const est = estimates.find((e) => e.serviceVisitId.toString() === v._id.toString())
    const inspection = inspByVisit.get(v._id.toString())
    if (!inspection || inspection.status !== 'COMPLETED') continue
    if (!est && params.status && params.status !== 'AWAITING_ESTIMATE') continue

    const rev = est ? currentRevision(est) : null
    items.push({
      serviceVisitId: v._id.toString(),
      serviceVisitNumber: v.visitNumber,
      inspectionReportNumber: inspection.inspectionNumber,
      inspectionCompletedAt: inspection.approvedAt,
      findingCount: inspection.findings?.length ?? 0,
      estimateId: est?._id.toString(),
      estimateNumber: est?.estimateNumber,
      estimateVersion: est?.currentRevisionNumber,
      estimateAmount: rev?.totals?.finalAmount,
      estimateStatus: est?.status ?? 'AWAITING_ESTIMATE',
      lastUpdated: est?.updatedAt ?? inspection.updatedAt,
    })
  }

  return { items, page: params.page ?? 1, limit: params.limit ?? 50, total: items.length }
}

export async function getEstimateDashboard(req: Request) {
  await syncEstimateQueue(req)
  const filter = tenantFilter(req)
  const counts: Record<string, number> = {
    awaitingEstimate: 0,
    draft: 0,
    internalReview: 0,
    sent: 0,
    customerApproved: 0,
    rejected: 0,
  }
  const rows = await Estimate.find(filter).select('status').lean()
  for (const r of rows) {
    if (r.status === 'DRAFT') counts.draft++
    else if (r.status === 'INTERNAL_REVIEW') counts.internalReview++
    else if (r.status === 'SENT_TO_CUSTOMER') counts.sent++
    else if (r.status === 'CUSTOMER_APPROVED' || r.status === 'PARTIALLY_APPROVED') counts.customerApproved++
    else if (r.status === 'REJECTED' || r.status === 'EXPIRED') counts.rejected++
  }
  const eligibleVisits = await ServiceVisit.countDocuments({
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
    currentStage: 'ESTIMATE',
  })
  counts.awaitingEstimate = Math.max(0, eligibleVisits - rows.length)
  return counts
}

export async function getEstimate(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
    .populate('serviceVisitId')
    .populate('bookingId')
    .populate('inspectionCaseId')
    .lean()
  if (!doc) throw new NotFoundError('Estimate not found')
  const ctx = await loadEstimateEligibilityContext(req, doc.serviceVisitId.toString())
  return { ...doc, id: doc._id.toString(), context: ctx }
}

export async function saveDraft(req: Request, id: string, body: { items: Array<Record<string, unknown>>; version?: number }) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  if (['CUSTOMER_APPROVED', 'SENT_TO_CUSTOMER'].includes(doc.status) && doc.revisions.some((r) => r.frozen)) {
    throw new ConflictError('Approved estimate cannot be edited; create a revision')
  }
  if (body.version != null && body.version !== doc.version) {
    throw new ConflictError('Estimate was updated elsewhere; refresh and retry')
  }

  const rev = currentRevision(doc)
  if (!rev || rev.frozen) throw new ConflictError('Current revision is frozen')

  const { items, totals } = await recalculateRevision(req, body.items, doc.serviceVisitId.toString())
  rev.items = items as unknown as NonNullable<ReturnType<typeof currentRevision>>['items']
  rev.totals = totals
  doc.version = (doc.version ?? 0) + 1
  doc.status = 'DRAFT'
  await doc.save()
  return { id: doc._id.toString(), totals, version: doc.version }
}

export async function submitInternalReview(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  doc.status = 'INTERNAL_REVIEW'
  await doc.save()
  return mapEstimate(doc)
}

export async function approveForSharing(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  doc.status = 'APPROVED_FOR_SHARING'
  await doc.save()
  return mapEstimate(doc)
}

export async function issueEstimate(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  const rev = currentRevision(doc)
  if (!rev) throw new ValidationError('No revision to issue')
  rev.frozen = true
  rev.issuedAt = new Date()
  rev.issuedBy = req.user?.id as unknown as typeof rev.issuedBy
  doc.status = 'SENT_TO_CUSTOMER'
  await doc.save()
  const { onEstimateIssued } = await import('../workflow/workflow-engine.service.js')
  await onEstimateIssued(req, doc.serviceVisitId.toString())
  return mapEstimate(doc)
}

export async function createRevision(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  const prev = currentRevision(doc)
  if (!prev) throw new ValidationError('No prior revision')
  const nextNum = doc.currentRevisionNumber + 1
  doc.revisions.push({
    revisionNumber: nextNum,
    items: JSON.parse(JSON.stringify(prev.items)),
    totals: JSON.parse(JSON.stringify(prev.totals)),
    frozen: false,
  })
  doc.currentRevisionNumber = nextNum
  doc.status = 'DRAFT'
  await doc.save()
  return mapEstimate(doc)
}

export async function recordCustomerDecision(
  req: Request,
  id: string,
  body: {
    decision: 'FULL_APPROVAL' | 'PARTIAL_APPROVAL' | 'REVISION_REQUESTED' | 'REJECTED'
    approvedLineIds?: string[]
    rejectedLineIds?: string[]
    remarks?: string
    verificationMethod?: string
  },
) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  const rev = currentRevision(doc)
  if (!rev?.frozen) throw new ValidationError('Estimate must be issued before customer decision')

  doc.approvals.push({
    revisionNumber: doc.currentRevisionNumber,
    actorType: 'CUSTOMER',
    decision: body.decision,
    approvedLineIds: body.approvedLineIds ?? [],
    rejectedLineIds: body.rejectedLineIds ?? [],
    verificationMethod: body.verificationMethod ?? 'PORTAL',
    customerRemarks: body.remarks,
  })

  if (body.decision === 'FULL_APPROVAL') {
    doc.status = 'CUSTOMER_APPROVED'
    for (const item of rev.items ?? []) {
      item.customerApprovalStatus = 'APPROVED'
    }
  } else if (body.decision === 'PARTIAL_APPROVAL') {
    doc.status = 'PARTIALLY_APPROVED'
    for (const item of rev.items ?? []) {
      const lid = item.lineId
      if (body.approvedLineIds?.includes(lid)) item.customerApprovalStatus = 'APPROVED'
      else if (body.rejectedLineIds?.includes(lid)) item.customerApprovalStatus = 'REJECTED'
    }
  } else if (body.decision === 'REVISION_REQUESTED') {
    doc.status = 'REVISION_REQUESTED'
  } else {
    doc.status = 'REJECTED'
  }

  await doc.save()
  return mapEstimate(doc)
}

export async function getEstimatePdf(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  if (!doc) throw new NotFoundError('Estimate not found')
  const rev = currentRevision(doc)
  if (!rev) throw new ValidationError('No revision')

  const [tenant, branch, visit] = await Promise.all([
    Tenant.findById(doc.tenantId).lean(),
    Branch.findById(doc.branchId).lean(),
    ServiceVisit.findById(doc.serviceVisitId).populate('customerId').populate('vehicleId').lean(),
  ])
  const customer = visit?.customerId as { name?: string; mobile?: string } | undefined
  const vehicle = visit?.vehicleId as { registrationNo?: string; make?: string; model?: string } | undefined

  const buffer = await generateEstimatePdfBuffer({
    tenantName: tenant?.name ?? 'Workshop',
    branchName: branch?.name ?? '',
    branchAddress: [branch?.address, branch?.city, branch?.state].filter(Boolean).join(', '),
    gstin: tenant?.gstin ?? undefined,
    phone: branch?.phone ?? undefined,
    estimateNumber: doc.estimateNumber,
    revisionNumber: doc.currentRevisionNumber,
    issueDate: new Date().toISOString().slice(0, 10),
    validUntil: doc.validUntil?.toISOString().slice(0, 10),
    customerName: customer?.name ?? 'Customer',
    customerMobile: customer?.mobile,
    registrationNo: vehicle?.registrationNo ?? '—',
    vehicleMakeModel: `${vehicle?.make ?? ''} ${vehicle?.model ?? ''}`.trim(),
    items: (rev.items ?? []).map((i) => ({
      description: i.description,
      category: i.category,
      hsnSac: i.hsnSac,
      quantity: i.quantity,
      unitRate: i.unitRate,
      discountAmount: i.discountAmount,
      finalAmount: i.finalAmount,
    })),
    totals: rev.totals as EstimateTotals,
  })

  return { buffer, filename: `${doc.estimateNumber}-R${doc.currentRevisionNumber}.pdf` }
}

export async function sendEstimateEmail(req: Request, id: string, recipient: string) {
  const { buffer, filename } = await getEstimatePdf(req, id)
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  const result = await sendTransactionalEmail({
    to: recipient,
    subject: `Service estimate ${doc?.estimateNumber ?? ''}`,
    text: `Please find attached estimate ${doc?.estimateNumber ?? ''}.`,
    attachment: { filename, content: buffer, contentType: 'application/pdf' },
  })
  const comm = await EstimateCommunication.create({
    tenantId: req.tenantId!,
    estimateId: id,
    channel: 'EMAIL',
    recipient,
    status: result.status === 'SENT' ? 'SENT' : 'FAILED',
    providerReference: result.providerReference,
    errorDetails: result.errorDetails,
  })
  return { communicationId: comm._id.toString(), status: comm.status, message: comm.errorDetails ?? result.providerReference }
}

export async function sendEstimateWhatsApp(req: Request, id: string, recipient: string) {
  const comm = await EstimateCommunication.create({
    tenantId: req.tenantId!,
    estimateId: id,
    channel: 'WHATSAPP',
    recipient,
    status: 'FAILED',
    errorDetails: 'WhatsApp Business API not configured. Use manual share or configure integration.',
  })
  return { communicationId: comm._id.toString(), status: comm.status, message: comm.errorDetails }
}

export async function getJobCardHandoff(req: Request, id: string) {
  const doc = await Estimate.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  if (!doc) throw new NotFoundError('Estimate not found')
  if (!['CUSTOMER_APPROVED', 'PARTIALLY_APPROVED'].includes(doc.status)) {
    throw new ValidationError('Estimate must be customer-approved for job card handoff')
  }
  const rev = currentRevision(doc)
  const approvedLines = (rev?.items ?? []).filter(
    (i) => i.customerApprovalStatus === 'APPROVED' || doc.status === 'CUSTOMER_APPROVED',
  )
  return {
    estimateId: doc._id.toString(),
    estimateNumber: doc.estimateNumber,
    revisionNumber: doc.currentRevisionNumber,
    serviceVisitId: doc.serviceVisitId.toString(),
    approvedItems: approvedLines,
    readyForJobCard: approvedLines.length > 0,
  }
}

export async function listPartsForEstimate(req: Request, search?: string) {
  const filter: Record<string, unknown> = { tenantId: req.tenantId!, isActive: true }
  if (search) filter.$or = [{ partNumber: new RegExp(search, 'i') }, { description: new RegExp(search, 'i') }]
  const parts = await Part.find(filter).limit(30).lean()
  const stocks = await StockBalance.find({ tenantId: req.tenantId!, partId: { $in: parts.map((p) => p._id) } }).lean()
  const stockMap = new Map(stocks.map((s) => [s.partId.toString(), s]))
  return parts.map((p) => ({
    id: p._id.toString(),
    partNumber: p.partNumber,
    description: p.description,
    hsn: p.hsn,
    gstPercent: p.gstPercent,
    mrp: p.mrp,
    availableStock: stockMap.get(p._id.toString())?.available ?? 0,
  }))
}

export async function listDiscounts(req: Request) {
  return DiscountPolicy.find({ tenantId: req.tenantId!, active: true }).lean()
}

export async function listTaxRules(req: Request) {
  return TaxRule.find({ tenantId: req.tenantId!, active: true, approvalStatus: 'APPROVED' }).sort({ effectiveFrom: -1 }).lean()
}

export async function addLogisticsChargesFromBooking(req: Request, estimateId: string) {
  const doc = await Estimate.findOne({ _id: estimateId, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Estimate not found')
  const booking = doc.bookingId
    ? await Booking.findOne({ _id: doc.bookingId, tenantId: req.tenantId! }).lean()
    : null
  if (!booking?.pickupRequired) {
    throw new ValidationError('Pickup not authorized on booking')
  }
  const rev = currentRevision(doc)
  if (!rev) throw new ValidationError('No revision')
  const hasPickup = (rev.items ?? []).some((i) => i.category === 'PICKUP')
  if (hasPickup) throw new ConflictError('Pickup charge already on estimate')

  const pickupLine = {
    lineId: randomUUID(),
    category: 'PICKUP',
    description: 'Vehicle pickup charge',
    quantity: 1,
    unitRate: 0,
    hsnSac: '996511',
    optional: false,
  }
  const items = [...(rev.items ?? []).map((i) => i.toObject?.() ?? i), pickupLine]
  const { items: calcItems, totals } = await recalculateRevision(req, items as Array<Record<string, unknown>>, doc.serviceVisitId.toString())
  rev.items = calcItems as unknown as NonNullable<ReturnType<typeof currentRevision>>['items']
  rev.totals = totals
  await doc.save()
  return { added: 'PICKUP', totals }
}
