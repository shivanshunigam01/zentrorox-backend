import type { Request } from 'express'
import {
  AdvancePayment,
  Booking,
  Customer,
  CustomerApproval,
  Estimate,
  FinancialAuthorization,
  InspectionCase,
  ReceivingRecord,
  ServiceVisit,
  Vehicle,
  VocRecord,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { createAuditLog } from '../../utils/audit.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { normalizeRegistrationNo } from '../../types/enums.js'
import * as estimatesService from '../estimates/estimates.service.js'
import { evaluateFinancialAuthorization } from './financial-auth.service.js'

function tenantFilter(req: Request) {
  return {
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }
}

function currentRevision(doc: unknown) {
  const d = doc as { revisions: Array<Record<string, unknown>>; currentRevisionNumber: number }
  return d.revisions.find((r) => r.revisionNumber === d.currentRevisionNumber) as {
    revisionNumber: number
    frozen?: boolean
    totals?: { finalAmount?: number }
    items?: Array<{ lineId: string; finalAmount?: number }>
    issuedAt?: Date
  } | undefined
}

const TAB_TO_ESTIMATE_STATUS: Record<string, string[]> = {
  PENDING_CUSTOMER_APPROVAL: ['SENT_TO_CUSTOMER'],
  FULLY_APPROVED: ['CUSTOMER_APPROVED'],
  PARTIALLY_APPROVED: ['PARTIALLY_APPROVED'],
  REVISION_REQUESTED: ['REVISION_REQUESTED'],
  REJECTED: ['REJECTED'],
}

export async function getApprovalDashboard(req: Request) {
  const base = { tenantId: req.tenantId!, ...(req.branchId && { branchId: req.branchId }) }
  const estimates = await Estimate.find(base).lean()
  let pendingEstimateApprovals = 0
  let approvedEstimates = 0
  let partiallyApproved = 0
  let rejectedEstimates = 0
  let approvedValue = 0
  let unapprovedValue = 0

  for (const e of estimates) {
    const rev = currentRevision(e)
    const total = rev?.totals?.finalAmount ?? 0
    if (e.status === 'SENT_TO_CUSTOMER') {
      pendingEstimateApprovals++
      unapprovedValue += total
    }
    if (e.status === 'CUSTOMER_APPROVED') {
      approvedEstimates++
      approvedValue += total
    }
    if (e.status === 'PARTIALLY_APPROVED') partiallyApproved++
    if (e.status === 'REJECTED') rejectedEstimates++
  }

  const advanceAgg = await AdvancePayment.aggregate([
    { $match: { ...base, verificationStatus: 'CONFIRMED' } },
    { $group: { _id: null, total: { $sum: '$receivedAmount' } } },
  ])
  const pendingAdvanceVerification = await AdvancePayment.countDocuments({
    ...base,
    verificationStatus: 'PENDING_VERIFICATION',
  })

  const financialAuths = await FinancialAuthorization.find(base).lean()
  let creditPending = 0
  let jobCardReady = 0
  for (const f of financialAuths) {
    if (f.financialAuthStatus === 'BLOCKED' || f.financialAuthStatus === 'PENDING') creditPending++
    if (f.jobCardAuthorized) jobCardReady++
  }

  return {
    pendingEstimateApprovals,
    approvedEstimates,
    partiallyApprovedEstimates: partiallyApproved,
    rejectedEstimates,
    advanceCollected: advanceAgg[0]?.total ?? 0,
    pendingAdvanceVerification,
    approvedValue,
    unapprovedValue,
    creditAuthorizationExceptions: creditPending,
    authorizedForJobCard: jobCardReady,
  }
}

export async function getApprovalQueue(
  req: Request,
  params: {
    tab?: string
    search?: string
    page?: number
    limit?: number
    advisorId?: string
    customerId?: string
    fromDate?: string
    toDate?: string
  },
) {
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(100, params.limit ?? 25)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = { ...tenantFilter(req) }

  if (params.tab === 'AUTHORIZED_FOR_JOB_CARD') {
    const authVisits = await FinancialAuthorization.find({
      tenantId: req.tenantId!,
      jobCardAuthorized: true,
    }).select('serviceVisitId').lean()
    filter.serviceVisitId = { $in: authVisits.map((a) => a.serviceVisitId) }
  } else if (params.tab && TAB_TO_ESTIMATE_STATUS[params.tab]) {
    filter.status = { $in: TAB_TO_ESTIMATE_STATUS[params.tab] }
  } else if (params.tab === 'ADVANCE_RECEIVED') {
    const visitIds = await AdvancePayment.distinct('serviceVisitId', {
      tenantId: req.tenantId!,
      verificationStatus: 'CONFIRMED',
    })
    filter.serviceVisitId = { $in: visitIds }
  } else if (params.tab === 'CREDIT_AUTHORIZATION_PENDING') {
    const visitIds = await FinancialAuthorization.distinct('serviceVisitId', {
      tenantId: req.tenantId!,
      financialAuthStatus: { $in: ['BLOCKED', 'PENDING'] },
    })
    filter.serviceVisitId = { $in: visitIds }
  }

  if (params.search) {
    const q = params.search.trim()
    const normReg = normalizeRegistrationNo(q)
    const vehicles = await Vehicle.find({
      tenantId: req.tenantId!,
      registrationNo: new RegExp(normReg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    }).limit(20).lean()
    const customers = await Customer.find({
      tenantId: req.tenantId!,
      $or: [{ mobile: new RegExp(q, 'i') }, { name: new RegExp(q, 'i') }],
    }).limit(20).lean()
    filter.$or = [
      { estimateNumber: new RegExp(q, 'i') },
      ...(vehicles.length ? [{ serviceVisitId: { $in: await visitIdsForVehicles(vehicles.map((v) => v._id)) } }] : []),
      ...(customers.length ? [{ serviceVisitId: { $in: await visitIdsForCustomers(customers.map((c) => c._id)) } }] : []),
    ]
  }

  const [total, rows] = await Promise.all([
    Estimate.countDocuments(filter),
    Estimate.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
  ])

  const visitIds = rows.map((r) => r.serviceVisitId)
  const visits = await ServiceVisit.find({ _id: { $in: visitIds } })
    .populate('customerId')
    .populate('vehicleId')
    .lean()
  const visitMap = new Map(visits.map((v) => [v._id.toString(), v]))

  const items = rows.map((est) => {
    const visit = visitMap.get(est.serviceVisitId.toString())
    const customer = visit?.customerId as { name?: string; mobile?: string } | undefined
    const vehicle = visit?.vehicleId as { registrationNo?: string } | undefined
    const rev = currentRevision(est)
    return {
      estimateId: est._id.toString(),
      estimateNumber: est.estimateNumber,
      estimateStatus: est.status,
      revisionNumber: est.currentRevisionNumber,
      estimateTotal: rev?.totals?.finalAmount ?? 0,
      serviceVisitId: est.serviceVisitId.toString(),
      serviceVisitNumber: visit?.visitNumber,
      customerName: customer?.name,
      customerMobile: customer?.mobile,
      vehicleRegistration: vehicle?.registrationNo,
      issuedAt: rev?.issuedAt,
    }
  })

  return { items, page, limit, total, totalPages: Math.ceil(total / limit) }
}

async function visitIdsForVehicles(vehicleIds: unknown[]) {
  const visits = await ServiceVisit.find({ vehicleId: { $in: vehicleIds } }).select('_id').lean()
  return visits.map((v) => v._id)
}

async function visitIdsForCustomers(customerIds: unknown[]) {
  const visits = await ServiceVisit.find({ customerId: { $in: customerIds } }).select('_id').lean()
  return visits.map((v) => v._id)
}

export async function searchByVehicle(req: Request, query: string) {
  if (!req.user?.permissions.includes('approvals.view')) {
    throw new ValidationError('Not authorized to search approval records')
  }
  const norm = normalizeRegistrationNo(query)
  const vehicles = await Vehicle.find({
    tenantId: req.tenantId!,
    registrationNo: new RegExp(norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  }).limit(10).lean()
  if (!vehicles.length) {
    return { vehicles: [], visits: [], message: 'No vehicles found' }
  }

  const results = []
  for (const vehicle of vehicles) {
    const customer = await Customer.findById(vehicle.customerId).lean()
    const visits = await ServiceVisit.find({
      tenantId: req.tenantId!,
      vehicleId: vehicle._id,
      ...(req.branchId && { branchId: req.branchId }),
    }).sort({ createdAt: -1 }).limit(15).lean()

    const visitRows = []
    for (const visit of visits) {
      const [booking, estimate, inspection, receiving, voc] = await Promise.all([
        visit.bookingId ? Booking.findById(visit.bookingId).lean() : null,
        Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).lean(),
        InspectionCase.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).lean(),
        ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId: visit._id }).lean(),
        VocRecord.findOne({ tenantId: req.tenantId!, visitId: visit._id }).lean(),
      ])
      const rev = estimate ? currentRevision(estimate) : null
      const approval = estimate
        ? await CustomerApproval.findOne({
            tenantId: req.tenantId!,
            serviceVisitId: visit._id,
            estimateRevisionNumber: estimate.currentRevisionNumber,
          }).sort({ recordedAt: -1 }).lean()
        : null

      visitRows.push({
        serviceVisitId: visit._id.toString(),
        visitNumber: visit.visitNumber,
        status: visit.status,
        currentStage: visit.currentStage,
        bookingNumber: booking?.bookingNumber,
        bookingDate: booking?.bookingDate,
        bookingType: booking?.bookingType,
        estimateId: estimate?._id.toString(),
        estimateNumber: estimate?.estimateNumber,
        estimateStatus: estimate?.status,
        estimateRevision: estimate?.currentRevisionNumber,
        estimateTotal: rev?.totals?.finalAmount,
        estimateIssued: rev?.frozen === true,
        approvalStatus: approval?.approvalStatus ?? (estimate?.status === 'SENT_TO_CUSTOMER' ? 'PENDING' : null),
        inspectionReference: inspection?.inspectionNumber,
        vocSummary: voc?.complaints?.[0]?.description ?? booking?.customerComplaint,
        receivingStatus: receiving?.receivingStatus,
        gateInAt: visit.stageLogs?.find((s) => s.stage === 'ARRIVAL')?.completedAt,
      })
    }

    results.push({
      vehicle: {
        id: vehicle._id.toString(),
        registrationNo: vehicle.registrationNo,
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant,
        fuelType: vehicle.fuelType,
        manufacturingYear: vehicle.manufacturingYear,
        chassisNo: vehicle.chassisNo,
        engineNo: vehicle.engineNo,
        odometer: vehicle.odometer,
      },
      customer: customer
        ? { id: customer._id.toString(), name: customer.name, mobile: customer.mobile, type: customer.type }
        : null,
      visits: visitRows,
    })
  }

  return { vehicles: results }
}

export async function getApprovalWorkspace(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({
    _id: visitId,
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }).populate('customerId').populate('vehicleId').lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const [booking, estimate, inspection, receiving, voc, approval] = await Promise.all([
    visit.bookingId ? Booking.findById(visit.bookingId).lean() : null,
    Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).lean(),
    InspectionCase.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).lean(),
    ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId: visit._id }).lean(),
    VocRecord.findOne({ tenantId: req.tenantId!, visitId: visit._id }).lean(),
    CustomerApproval.findOne({ tenantId: req.tenantId!, serviceVisitId: visit._id }).sort({ recordedAt: -1 }).lean(),
  ])

  if (!estimate) throw new ValidationError('No estimate for this visit')
  const rev = currentRevision(estimate)
  if (!rev?.frozen) throw new ValidationError('Estimate must be issued before approval workspace')

  const financialAuth = await evaluateFinancialAuthorization(req, visitId)

  const customer = visit.customerId as {
    _id: { toString(): string }
    name?: string
    mobile?: string
    email?: string
    address?: string
    city?: string
    gstin?: string
  }
  const vehicle = visit.vehicleId as {
    registrationNo?: string
    make?: string
    model?: string
    variant?: string
    fuelType?: string
    manufacturingYear?: number
    chassisNo?: string
    engineNo?: string
    odometer?: number
  }

  return {
    visit: {
      id: visit._id.toString(),
      visitNumber: visit.visitNumber,
      advisorId: visit.advisorId?.toString(),
      pickupRequired: visit.pickupRequired,
      pickupAddress: visit.pickupAddress,
    },
    customer: {
      id: customer._id.toString(),
      name: customer.name,
      mobile: customer.mobile,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      gstin: customer.gstin,
    },
    vehicle,
    booking,
    inspection: inspection
      ? { inspectionNumber: inspection.inspectionNumber, status: inspection.status }
      : null,
    receiving: receiving ? { status: receiving.receivingStatus } : null,
    voc: voc
      ? {
          complaints: voc.complaints,
          status: voc.confirmationStatus,
        }
      : null,
    estimate: {
      id: estimate._id.toString(),
      estimateNumber: estimate.estimateNumber,
      status: estimate.status,
      currentRevisionNumber: estimate.currentRevisionNumber,
      validUntil: estimate.validUntil,
      revision: rev,
    },
    approval,
    financialAuthorization: financialAuth,
  }
}

export async function recordApprovalDecision(
  req: Request,
  visitId: string,
  body: {
    decision: 'FULLY_APPROVED' | 'PARTIALLY_APPROVED' | 'REVISION_REQUESTED' | 'REJECTED'
    approvedLineIds?: string[]
    rejectedLineIds?: string[]
    approvalSource: string
    customerRemarks?: string
    advisorRemarks?: string
    customerVerificationMethod?: string
    termsAccepted?: boolean
    confirmationReference?: string
    contactedNumber?: string
    callDateTime?: string
    evidenceReferences?: string[]
    idempotencyKey?: string
  },
) {
  if (body.idempotencyKey) {
    const dup = await CustomerApproval.findOne({
      tenantId: req.tenantId!,
      idempotencyKey: body.idempotencyKey,
    }).lean()
    if (dup) return { approval: dup, duplicate: true }
  }

  const workspace = await getApprovalWorkspace(req, visitId)
  const estimateId = workspace.estimate.id
  const rev = workspace.estimate.revision as { totals?: { finalAmount?: number }; items?: Array<{ lineId: string }> }

  if (workspace.estimate.validUntil && new Date(workspace.estimate.validUntil) < new Date()) {
    throw new ValidationError('Estimate revision has expired')
  }
  if (!['SENT_TO_CUSTOMER', 'PARTIALLY_APPROVED'].includes(workspace.estimate.status) && body.decision !== 'REJECTED') {
    if (workspace.estimate.status !== 'SENT_TO_CUSTOMER') {
      throw new ValidationError('Approval only allowed against issued estimate awaiting customer decision')
    }
  }

  const decisionMap = {
    FULLY_APPROVED: 'FULL_APPROVAL',
    PARTIALLY_APPROVED: 'PARTIAL_APPROVAL',
    REVISION_REQUESTED: 'REVISION_REQUESTED',
    REJECTED: 'REJECTED',
  } as const

  await estimatesService.recordCustomerDecision(req, estimateId, {
    decision: decisionMap[body.decision],
    approvedLineIds: body.approvedLineIds,
    rejectedLineIds: body.rejectedLineIds,
    remarks: body.customerRemarks,
    verificationMethod: body.customerVerificationMethod ?? 'STAFF_RECORDED',
  })

  const total = rev.totals?.finalAmount ?? 0
  let approvedAmount = total
  let rejectedAmount = 0
  if (body.decision === 'PARTIALLY_APPROVED' && body.approvedLineIds?.length) {
    approvedAmount = 0
    for (const item of rev.items ?? []) {
      if (body.approvedLineIds.includes(item.lineId)) {
        approvedAmount += (item as { finalAmount?: number }).finalAmount ?? 0
      }
    }
    rejectedAmount = Math.max(0, total - approvedAmount)
  } else if (body.decision === 'REJECTED') {
    approvedAmount = 0
    rejectedAmount = total
  }

  const approvalReference = await generateDocumentNumber(req.tenantId!, 'CUSTOMER_APPROVAL')
  const visit = await ServiceVisit.findById(visitId).lean()
  if (!visit) throw new NotFoundError('Visit not found')

  const approval = await CustomerApproval.create({
    tenantId: req.tenantId!,
    branchId: visit.branchId,
    approvalReference,
    customerId: visit.customerId,
    vehicleId: visit.vehicleId,
    bookingId: visit.bookingId,
    serviceVisitId: visit._id,
    estimateId,
    estimateRevisionNumber: workspace.estimate.currentRevisionNumber,
    estimateAmount: total,
    approvalType: body.decision,
    approvedAmount,
    rejectedAmount,
    selectedApprovedLineIds: body.approvedLineIds ?? [],
    approvalSource: body.approvalSource,
    customerRemarks: body.customerRemarks,
    advisorRemarks: body.advisorRemarks,
    approvalStatus: body.decision,
    customerVerificationMethod: body.customerVerificationMethod,
    staffRecorded: true,
    evidenceReferences: body.evidenceReferences ?? [],
    termsAccepted: body.termsAccepted ?? false,
    confirmationReference: body.confirmationReference,
    contactedNumber: body.contactedNumber,
    callDateTime: body.callDateTime ? new Date(body.callDateTime) : undefined,
    recordedBy: req.user?.id,
    recordedAt: new Date(),
    idempotencyKey: body.idempotencyKey,
    history: [{ action: 'RECORDED', at: new Date(), by: req.user?.id, snapshot: body }],
  })

  await evaluateFinancialAuthorization(req, visitId)
  await createAuditLog({
    req,
    module: 'approvals',
    action: 'DECISION_RECORDED',
    recordId: approval._id.toString(),
    newValue: { decision: body.decision, visitId },
  })

  return { approval, duplicate: false }
}
