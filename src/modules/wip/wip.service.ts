import type { Request } from 'express'
import {
  AdditionalWorkRequest,
  AdvancePayment,
  Booking,
  CustomerApproval,
  Estimate,
  FinancialAuthorization,
  InspectionCase,
  JobCard,
  JobCardRevision,
  JobWorkItem,
  PartsRequisition,
  ReceivingRecord,
  ServiceVisit,
  StockIssue,
  VocRecord,
  WipRecord,
  WorkAssignment,
  WorkSession,
  WorkshopLocation,
} from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import type { WipQueueTab, WipWorkItemExecutionStatus } from '../../types/enums.js'
import { sellableAvailable } from '../inventory/inventory-transaction.service.js'
import { StockBalance, Part } from '../../models/index.js'

const RELEASED_JC_STATUSES = ['READY_TO_START', 'IN_PROGRESS', 'ON_HOLD', 'WORK_COMPLETED', 'READY_FOR_QC', 'IN_PROGRESS']

export async function ensureWipRecordForJobCard(req: Request, jobCardId: string) {
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const released = await WorkAssignment.countDocuments({
    tenantId: req.tenantId!,
    jobCardId: jc._id,
    status: { $in: ['RELEASED', 'IN_PROGRESS', 'COMPLETED'] },
  })
  if (released === 0 && !['IN_PROGRESS', 'READY_TO_START', 'WORK_COMPLETED', 'READY_FOR_QC'].includes(jc.status)) {
    throw new ValidationError('Job card is not released for workshop execution')
  }

  let wip = await WipRecord.findOne({ tenantId: req.tenantId!, jobCardId: jc._id })
  if (!wip) {
    wip = await WipRecord.create({
      tenantId: req.tenantId!,
      branchId: jc.branchId,
      jobCardId: jc._id,
      serviceVisitId: jc.serviceVisitId,
      status: jc.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'READY_TO_START',
    })
  }
  await refreshWipProgress(wip._id.toString())
  return wip
}

async function refreshWipProgress(wipId: string) {
  const wip = await WipRecord.findById(wipId)
  if (!wip) return
  const items = await JobWorkItem.find({ jobCardId: wip.jobCardId })
  const total = items.length
  const completed = items.filter((i) => ['COMPLETED', 'VERIFIED'].includes(i.executionStatus ?? '')).length
  const inProg = items.filter((i) => i.executionStatus === 'IN_PROGRESS').length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  wip.progressSummary = { totalWorkItems: total, completedWorkItems: completed, inProgressWorkItems: inProg, completionPercent: pct }
  const pendingParts = await PartsRequisition.countDocuments({
    jobCardId: wip.jobCardId,
    status: { $in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED'] },
  })
  const addPending = await AdditionalWorkRequest.countDocuments({
    jobCardId: wip.jobCardId,
    status: { $in: ['SUBMITTED', 'SUPERVISOR_REVIEW', 'SENT_TO_CUSTOMER', 'ESTIMATE_PREPARED'] },
  })
  wip.partsHold = pendingParts > 0 && items.some((i) => i.executionStatus === 'WAITING_FOR_PARTS')
  wip.additionalApprovalPending = addPending > 0
  if (addPending > 0) wip.status = 'ADDITIONAL_APPROVAL_PENDING'
  else if (wip.partsHold) wip.status = 'AWAITING_PARTS'
  else if (completed === total && total > 0) wip.status = 'WORK_COMPLETED'
  else if (inProg > 0) wip.status = 'IN_PROGRESS'
  else if (completed > 0 && completed < total) wip.status = 'PARTIALLY_COMPLETED'
  await wip.save()
}

export async function getWipDashboard(req: Request) {
  const tenantId = req.tenantId!
  const branchFilter: Record<string, unknown> = { tenantId }
  if (req.branchId) branchFilter.branchId = req.branchId

  const [activeJobCards, vehiclesUnderRepair, workItemsPending, workItemsInProgress, completedItems, awaitingParts, addPending, overdue, readyQc] =
    await Promise.all([
      WipRecord.countDocuments({ ...branchFilter, status: { $in: ['IN_PROGRESS', 'PARTIALLY_COMPLETED', 'READY_TO_START'] } }),
      WipRecord.countDocuments({ ...branchFilter, status: { $in: ['IN_PROGRESS', 'PARTIALLY_COMPLETED', 'AWAITING_PARTS'] } }),
      JobWorkItem.countDocuments({ tenantId, executionStatus: { $in: ['NOT_STARTED', 'RELEASED'] } }),
      JobWorkItem.countDocuments({ tenantId, executionStatus: 'IN_PROGRESS' }),
      JobWorkItem.countDocuments({ tenantId, executionStatus: { $in: ['COMPLETED', 'VERIFIED'] } }),
      WipRecord.countDocuments({ ...branchFilter, status: 'AWAITING_PARTS' }),
      WipRecord.countDocuments({ ...branchFilter, additionalApprovalPending: true }),
      JobCard.countDocuments({
        ...branchFilter,
        customerPromisedDelivery: { $lt: new Date() },
        status: { $nin: ['WORK_COMPLETED', 'READY_FOR_QC', 'CANCELLED', 'COMPLETED'] },
      }),
      WipRecord.countDocuments({ ...branchFilter, status: 'READY_FOR_QC' }),
    ])

  return {
    activeJobCards,
    vehiclesUnderRepair,
    workItemsPending,
    workItemsInProgress,
    completedWorkItems: completedItems,
    vehiclesAwaitingParts: awaitingParts,
    additionalWorkApprovalPending: addPending,
    overdueJobs: overdue,
    jobsReadyForQc: readyQc,
  }
}

function tabFilter(tab: WipQueueTab): Record<string, unknown> {
  switch (tab) {
    case 'READY_TO_START':
      return { status: 'READY_TO_START' }
    case 'IN_PROGRESS':
      return { status: 'IN_PROGRESS' }
    case 'PARTIALLY_COMPLETED':
      return { status: 'PARTIALLY_COMPLETED' }
    case 'ON_HOLD':
      return { status: 'ON_HOLD' }
    case 'AWAITING_PARTS':
      return { status: 'AWAITING_PARTS' }
    case 'ADDITIONAL_APPROVAL_PENDING':
      return { status: 'ADDITIONAL_APPROVAL_PENDING' }
    case 'COMPLETED':
      return { status: 'WORK_COMPLETED' }
    case 'READY_FOR_QC':
      return { status: 'READY_FOR_QC' }
    default:
      return {}
  }
}

export async function getWipQueue(req: Request, params: {
  tab?: string
  search?: string
  page?: number
  limit?: number
  teamId?: string
  mechanicId?: string
}) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit
  const tab = (params.tab ?? 'IN_PROGRESS') as WipQueueTab

  const eligibleJcs = await JobCard.find({
    tenantId,
    ...(req.branchId ? { branchId: req.branchId } : {}),
    status: { $in: RELEASED_JC_STATUSES },
  }).select('_id').lean()

  for (const row of eligibleJcs) {
    try {
      await ensureWipRecordForJobCard(req, row._id.toString())
    } catch {
      /* not yet released */
    }
  }

  const filter: Record<string, unknown> = { tenantId, ...tabFilter(tab) }
  if (req.branchId) filter.branchId = req.branchId

  const wips = await WipRecord.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean()
  const total = await WipRecord.countDocuments(filter)

  const items = []
  for (const w of wips) {
    const row = await buildQueueRow(req, w.jobCardId.toString())
    if (!row) continue
    if (params.search) {
      const q = params.search.toLowerCase()
      const hay = `${row.jobCardNumber} ${row.registration} ${row.customerName} ${row.bookingNumber}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    items.push(row)
  }

  return { items, page, limit, total }
}

async function buildQueueRow(req: Request, jobCardId: string) {
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
    .populate('customerId')
    .populate('vehicleId')
    .lean()
  if (!jc) return null
  const visit = await ServiceVisit.findById(jc.serviceVisitId).lean()
  const booking = jc.bookingId ? await Booking.findById(jc.bookingId).lean() : null
  const wip = await WipRecord.findOne({ jobCardId: jc._id }).lean()
  const assignment = await WorkAssignment.findOne({ jobCardId: jc._id, status: { $ne: 'CANCELLED' } })
    .populate('teamId')
    .populate('leadMechanicId')
    .lean()
  const location = assignment?.locationId
    ? await WorkshopLocation.findById(assignment.locationId).lean()
    : null
  const customer = jc.customerId as { name?: string; mobile?: string } | null
  const vehicle = jc.vehicleId as { registrationNo?: string; make?: string; model?: string } | null
  const fin = await FinancialAuthorization.findOne({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId }).lean()
  const advance = await AdvancePayment.aggregate([
    { $match: { tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId, verificationStatus: 'VERIFIED' } },
    { $group: { _id: null, total: { $sum: '$receivedAmount' } } },
  ])
  const lead = assignment?.leadMechanicId as { firstName?: string; lastName?: string } | null | undefined

  return {
    wipId: wip?._id?.toString(),
    jobCardId: jc._id.toString(),
    jobCardNumber: jc.jobCardNumber,
    jobCardRevision: jc.revisionNumber ?? 1,
    registration: vehicle?.registrationNo,
    vehicleMakeModel: [vehicle?.make, vehicle?.model].filter(Boolean).join(' '),
    customerName: customer?.name,
    customerMobile: customer?.mobile,
    bookingNumber: booking?.bookingNumber ?? visit?.visitNumber,
    serviceVisitNumber: visit?.visitNumber,
    jobCardDate: jc.createdAt,
    assignedTeam: (assignment?.teamId as { name?: string } | undefined)?.name,
    supervisorId: assignment?.supervisorId?.toString(),
    floorInChargeId: assignment?.floorInChargeId?.toString(),
    assignedMechanic: lead ? `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() : undefined,
    location: location?.name,
    approvedEstimateAmount: jc.approvedValue,
    additionalApprovedAmount: jc.supplementaryApprovedValue ?? 0,
    partsStatus: wip?.partsHold ? 'HOLD' : 'OK',
    paymentStatus: fin?.financialAuthStatus ?? 'UNKNOWN',
    advanceReceived: advance[0]?.total ?? 0,
    plannedDelivery: jc.customerPromisedDelivery,
    completionPercent: wip?.progressSummary?.completionPercent ?? 0,
    jobCardStatus: jc.status,
    wipStatus: wip?.status,
  }
}

export async function getWipWorkspace(req: Request, jobCardId: string) {
  await ensureWipRecordForJobCard(req, jobCardId)
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! }).lean()
  if (!jc) throw new NotFoundError('Job card not found')

  const [visit, workItems, assignments, wip, requisitions, issues, additionalWork, revisions, voc, inspection, receiving] =
    await Promise.all([
      ServiceVisit.findById(jc.serviceVisitId).populate('customerId').populate('vehicleId').lean(),
      JobWorkItem.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean(),
      WorkAssignment.find({ tenantId: req.tenantId!, jobCardId: jc._id }).populate('teamId').lean(),
      WipRecord.findOne({ jobCardId: jc._id }).lean(),
      PartsRequisition.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean(),
      StockIssue.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean(),
      AdditionalWorkRequest.find({ tenantId: req.tenantId!, jobCardId: jc._id }).sort({ createdAt: -1 }).lean(),
      JobCardRevision.find({ tenantId: req.tenantId!, jobCardId: jc._id }).sort({ revisionNumber: 1 }).lean(),
      VocRecord.findOne({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId }).lean(),
      InspectionCase.findOne({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId }).lean(),
      ReceivingRecord.findOne({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId }).lean(),
    ])

  const estimate = jc.estimateId ? await Estimate.findById(jc.estimateId).lean() : null
  const supplementary = await Estimate.find({
    tenantId: req.tenantId!,
    serviceVisitId: jc.serviceVisitId,
    estimateKind: 'SUPPLEMENTARY',
  }).lean()
  const approval = await CustomerApproval.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: jc.serviceVisitId,
  }).sort({ recordedAt: -1 }).lean()
  const fin = await FinancialAuthorization.findOne({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId }).lean()
  const advance = await AdvancePayment.find({ tenantId: req.tenantId!, serviceVisitId: jc.serviceVisitId, verificationStatus: 'VERIFIED' }).lean()

  const partsReadiness = await buildPartsReadiness(req, jc._id.toString(), workItems)

  return {
    wip,
    jobCard: jc,
    visit,
    booking: visit?.bookingId ? await Booking.findById(visit.bookingId).lean() : null,
    customer: visit?.customerId,
    vehicle: visit?.vehicleId,
    technical: { voc, inspection, receiving },
    commercial: { estimate, supplementary, approval, financialAuthorization: fin, advances: advance },
    workshop: { workItems, assignments, requisitions, stockIssues: issues, additionalWork, revisions },
    partsReadiness,
    financialOverview: {
      approvedOriginal: jc.approvedValue,
      supplementaryApproved: jc.supplementaryApprovedValue ?? 0,
      revisedAuthorized: (jc.approvedValue ?? 0) + (jc.supplementaryApprovedValue ?? 0),
      advanceReceived: advance.reduce((s, a) => s + (a.receivedAmount ?? 0), 0),
      financialHold: fin?.financialAuthStatus === 'BLOCKED',
    },
  }
}

async function buildPartsReadiness(
  req: Request,
  jobCardId: string,
  workItems: Array<{ _id: unknown; requiredPartCodes?: string[] }>,
) {
  const codes = new Set<string>()
  for (const w of workItems) {
    for (const c of w.requiredPartCodes ?? []) codes.add(c)
  }
  if (codes.size === 0) return []
  const parts = await Part.find({ tenantId: req.tenantId!, partNumber: { $in: [...codes] } }).lean()
  const balances = await StockBalance.find({ tenantId: req.tenantId!, partId: { $in: parts.map((p) => p._id) } }).lean()
  const balMap = new Map(balances.map((b) => [b.partId.toString(), b]))
  return parts.map((p) => {
    const bal = balMap.get(p._id.toString())
    const onHand = bal ? sellableAvailable(bal) : 0
    return {
      partCode: p.partNumber,
      description: p.description,
      availableStock: onHand,
      availabilityStatus: onHand > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
    }
  })
}

const EXECUTION_TRANSITIONS: Record<string, WipWorkItemExecutionStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_APPROVAL', 'CANCELLED'],
  IN_PROGRESS: ['PAUSED', 'COMPLETED', 'WAITING_FOR_PARTS', 'WAITING_FOR_APPROVAL', 'CANCELLED'],
  PAUSED: ['IN_PROGRESS', 'CANCELLED'],
  WAITING_FOR_PARTS: ['IN_PROGRESS', 'PAUSED', 'CANCELLED'],
  WAITING_FOR_APPROVAL: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['VERIFIED', 'REWORK_REQUIRED'],
  REWORK_REQUIRED: ['IN_PROGRESS'],
}

export async function updateWorkItem(
  req: Request,
  jobCardId: string,
  itemId: string,
  body: Record<string, unknown>,
) {
  await ensureWipRecordForJobCard(req, jobCardId)
  const item = await JobWorkItem.findOne({ _id: itemId, jobCardId, tenantId: req.tenantId! })
  if (!item) throw new NotFoundError('Work item not found')

  if (body.executionStatus) {
    const next = String(body.executionStatus) as WipWorkItemExecutionStatus
    const cur = (item.executionStatus ?? 'NOT_STARTED') as WipWorkItemExecutionStatus
    const allowed = EXECUTION_TRANSITIONS[cur] ?? []
    if (next !== cur && !allowed.includes(next)) {
      throw new ValidationError(`Cannot transition work item from ${cur} to ${next}`)
    }
    item.executionStatus = next
    if (next === 'IN_PROGRESS' && !item.actualStart) item.actualStart = new Date()
    if (next === 'PAUSED') item.technicianRemarks = String(body.technicianRemarks ?? item.technicianRemarks ?? '')
  }

  if (body.technicianRemarks != null) item.technicianRemarks = String(body.technicianRemarks)
  if (body.supervisorRemarks != null) item.supervisorRemarks = String(body.supervisorRemarks)
  if (body.completionPercent != null) item.completionPercent = Math.min(100, Math.max(0, Number(body.completionPercent)))
  if (body.workDoneDescription != null) item.workDoneDescription = String(body.workDoneDescription)

  await item.save()
  const wip = await WipRecord.findOne({ jobCardId })
  if (wip) await refreshWipProgress(wip._id.toString())
  return item
}

export async function completeWorkItem(req: Request, jobCardId: string, itemId: string, body: Record<string, unknown>) {
  const item = await updateWorkItem(req, jobCardId, itemId, {
    ...body,
    executionStatus: 'COMPLETED',
  })
  if (!item.workDoneDescription?.trim()) {
    throw new ValidationError('Work performed description is required to complete')
  }
  item.workCompleted = true
  item.actualFinish = new Date()
  item.completionPercent = 100
  await item.save()
  const wip = await WipRecord.findOne({ jobCardId })
  if (wip) await refreshWipProgress(wip._id.toString())
  return item
}

export async function verifyWorkItem(req: Request, jobCardId: string, itemId: string, body: Record<string, unknown>) {
  const item = await JobWorkItem.findOne({ _id: itemId, jobCardId, tenantId: req.tenantId! })
  if (!item) throw new NotFoundError('Work item not found')
  if (item.executionStatus !== 'COMPLETED' && !item.workCompleted) {
    throw new ValidationError('Work item must be completed before verification')
  }
  if (body.accept === false) {
    item.executionStatus = 'REWORK_REQUIRED'
    item.supervisorRemarks = String(body.supervisorRemarks ?? 'Rework required')
    await item.save()
    return item
  }
  item.executionStatus = 'VERIFIED'
  item.verifiedBy = req.user?.id as unknown as typeof item.verifiedBy
  item.verifiedAt = new Date()
  item.supervisorRemarks = String(body.supervisorRemarks ?? item.supervisorRemarks ?? '')
  await item.save()
  const wip = await WipRecord.findOne({ jobCardId })
  if (wip) await refreshWipProgress(wip._id.toString())
  return item
}

export async function startWip(req: Request, jobCardId: string) {
  const wip = await ensureWipRecordForJobCard(req, jobCardId)
  const jc = await JobCard.findById(jobCardId)
  if (!jc) throw new NotFoundError('Job card not found')
  wip.status = 'IN_PROGRESS'
  wip.startedAt = wip.startedAt ?? new Date()
  await wip.save()
  if (jc.status === 'READY_TO_START') {
    jc.status = 'IN_PROGRESS'
    jc.workActualStart = jc.workActualStart ?? new Date()
    await jc.save()
  }
  await createAuditLog({ req, module: 'wip', action: 'STARTED', recordId: jobCardId })
  return { wip, jobCard: jc }
}

export async function startWorkSession(req: Request, jobCardId: string, body: { workItemId: string; teamId?: string }) {
  await ensureWipRecordForJobCard(req, jobCardId)
  const active = await WorkSession.findOne({
    tenantId: req.tenantId!,
    technicianId: req.user?.id,
    status: 'ACTIVE',
  })
  if (active) throw new ValidationError('Technician already has an active work session')

  const session = await WorkSession.create({
    tenantId: req.tenantId!,
    branchId: req.branchId,
    jobCardId,
    workItemId: body.workItemId,
    technicianId: req.user?.id,
    teamId: body.teamId,
    startTime: new Date(),
    status: 'ACTIVE',
  })

  await updateWorkItem(req, jobCardId, body.workItemId, { executionStatus: 'IN_PROGRESS' })
  return session
}

export async function pauseWorkSession(req: Request, jobCardId: string, sessionId: string, body: { reason?: string }) {
  const session = await WorkSession.findOne({ _id: sessionId, jobCardId, tenantId: req.tenantId! })
  if (!session || session.status !== 'ACTIVE') throw new NotFoundError('Active session not found')
  session.status = 'PAUSED'
  session.pauseTime = new Date()
  session.pauseReason = body.reason
  await session.save()
  await updateWorkItem(req, jobCardId, session.workItemId.toString(), { executionStatus: 'PAUSED', technicianRemarks: body.reason })
  return session
}

export async function resumeWorkSession(req: Request, jobCardId: string, sessionId: string) {
  const session = await WorkSession.findOne({ _id: sessionId, jobCardId, tenantId: req.tenantId! })
  if (!session || session.status !== 'PAUSED') throw new NotFoundError('Paused session not found')
  const active = await WorkSession.findOne({ tenantId: req.tenantId!, technicianId: req.user?.id, status: 'ACTIVE' })
  if (active) throw new ValidationError('Technician already has an active work session')
  session.status = 'ACTIVE'
  session.resumeTime = new Date()
  await session.save()
  await updateWorkItem(req, jobCardId, session.workItemId.toString(), { executionStatus: 'IN_PROGRESS' })
  return session
}

export async function endWorkSession(req: Request, jobCardId: string, sessionId: string) {
  const session = await WorkSession.findOne({ _id: sessionId, jobCardId, tenantId: req.tenantId! })
  if (!session || session.status === 'ENDED') throw new NotFoundError('Session not found')
  const end = new Date()
  session.endTime = end
  session.status = 'ENDED'
  const start = session.resumeTime ?? session.startTime
  const minutes = Math.max(0, Math.round((end.getTime() - new Date(start).getTime()) / 60000))
  session.actualLabourMinutes = minutes
  await session.save()

  const item = await JobWorkItem.findById(session.workItemId)
  if (item) {
    item.actualLabourMinutes = (item.actualLabourMinutes ?? 0) + minutes
    await item.save()
  }
  return session
}

export async function submitJobCompletion(req: Request, jobCardId: string) {
  const wip = await ensureWipRecordForJobCard(req, jobCardId)
  const items = await JobWorkItem.find({ jobCardId, tenantId: req.tenantId! })
  const mandatory = items.filter((i) => i.executionStatus !== 'CANCELLED')
  const incomplete = mandatory.filter((i) => !['COMPLETED', 'VERIFIED'].includes(i.executionStatus ?? ''))
  if (incomplete.length) throw new ValidationError('All authorized work items must be completed before job completion')

  const blocking = await AdditionalWorkRequest.countDocuments({
    jobCardId,
    status: { $in: ['SUBMITTED', 'SUPERVISOR_REVIEW', 'SENT_TO_CUSTOMER', 'ESTIMATE_PREPARED'] },
  })
  if (blocking > 0) throw new ValidationError('Pending additional work approval blocks completion')

  wip.status = 'WORK_COMPLETED'
  wip.completedAt = new Date()
  await wip.save()

  const jc = await JobCard.findById(jobCardId)
  if (jc) {
    jc.status = 'WORK_COMPLETED'
    jc.actualWorkCompletion = new Date()
    await jc.save()
  }
  return { wip }
}

export async function verifyJobCompletion(req: Request, jobCardId: string) {
  const wip = await WipRecord.findOne({ jobCardId, tenantId: req.tenantId! })
  if (!wip || wip.status !== 'WORK_COMPLETED') {
    throw new ValidationError('Job must be work-completed before QC handoff')
  }
  const unverified = await JobWorkItem.countDocuments({
    jobCardId,
    executionStatus: 'COMPLETED',
    qcRequired: true,
  })
  if (unverified > 0) throw new ValidationError('Supervisor must verify all QC-required work items')

  wip.status = 'READY_FOR_QC'
  await wip.save()
  const jc = await JobCard.findById(jobCardId)
  if (jc) {
    jc.status = 'READY_FOR_QC'
    await jc.save()
  }
  await createAuditLog({ req, module: 'wip', action: 'RELEASE_QC', recordId: jobCardId })

  try {
    const { ensureQcCaseForJobCard } = await import('../qc/qc.service.js')
    await ensureQcCaseForJobCard(req, jobCardId)
  } catch {
    /* eligibility enforced when opening QC queue */
  }

  const jcVisit = await JobCard.findById(jobCardId).select('serviceVisitId')
  if (jcVisit?.serviceVisitId) {
    const { onWipReleasedToQc } = await import('../workflow/workflow-engine.service.js')
    await onWipReleasedToQc(req, jcVisit.serviceVisitId.toString())
  }

  return { wip }
}

export async function getWipByJobCard(req: Request, jobCardId: string) {
  return getWipWorkspace(req, jobCardId)
}
