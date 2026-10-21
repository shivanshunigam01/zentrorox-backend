import type { Request } from 'express'
import {
  AdvancePayment,
  Booking,
  Branch,
  Customer,
  CustomerApproval,
  Estimate,
  FinancialAuthorization,
  InspectionCase,
  JobCard,
  JobWorkItem,
  LocationReservation,
  ReceivingRecord,
  ServiceVisit,
  Tenant,
  VocRecord,
  WorkAssignment,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { createAuditLog } from '../../utils/audit.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { assertEligibleForJobCard } from './job-card-eligibility.js'
import { calculateDeliverySchedule } from './delivery-schedule.js'
import { generateJobCardPdfBuffer } from './job-card-pdf.service.js'
import * as estimatesService from '../estimates/estimates.service.js'

function currentRevision(doc: unknown) {
  const d = doc as { revisions: Array<Record<string, unknown>>; currentRevisionNumber: number }
  return d.revisions.find((r) => r.revisionNumber === d.currentRevisionNumber) as {
    frozen?: boolean
    items?: Array<{
      lineId: string
      category?: string
      description?: string
      quantity?: number
      uom?: string
      labourHours?: number
      customerApprovalStatus?: string
      finalAmount?: number
    }>
    totals?: { finalAmount?: number }
  } | undefined
}

function tenantFilter(req: Request) {
  return { tenantId: req.tenantId!, ...(req.branchId && { branchId: req.branchId }) }
}

export async function getJobCardDashboard(req: Request) {
  const base = tenantFilter(req)
  const counts = await JobCard.aggregate([
    { $match: base },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])
  const map: Record<string, number> = {}
  for (const c of counts) map[c._id] = c.count
  return {
    readyForAssignment: map.READY_FOR_ASSIGNMENT ?? 0,
    assignmentInProgress: map.ASSIGNMENT_IN_PROGRESS ?? 0,
    assigned: map.ASSIGNED ?? 0,
    readyToStart: map.READY_TO_START ?? 0,
    inProgress: map.IN_PROGRESS ?? 0,
    onHold: map.ON_HOLD ?? 0,
    workCompleted: map.WORK_COMPLETED ?? map.COMPLETED ?? 0,
    total: Object.values(map).reduce((a, b) => a + b, 0),
  }
}

export async function getJobCardQueue(req: Request, params: { tab?: string; search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(100, params.limit ?? 25)
  const skip = (page - 1) * limit

  const eligibles = await buildEligibleVisitRows(req)
  let rows = eligibles

  const tab = params.tab ?? 'AWAITING_ASSIGNMENT'
  if (tab !== 'AWAITING_ASSIGNMENT') {
    const statusMap: Record<string, string[]> = {
      ASSIGNMENT_IN_PROGRESS: ['ASSIGNMENT_IN_PROGRESS'],
      ASSIGNED: ['ASSIGNED'],
      READY_TO_START: ['READY_TO_START'],
      IN_PROGRESS: ['IN_PROGRESS', 'OPEN'],
      ON_HOLD: ['ON_HOLD'],
      COMPLETED: ['WORK_COMPLETED', 'COMPLETED'],
    }
    const statuses = statusMap[tab]
    if (statuses) {
      const jcs = await JobCard.find({ ...tenantFilter(req), status: { $in: statuses } }).lean()
      const visitIds = new Set(jcs.map((j) => j.serviceVisitId.toString()))
      rows = await enrichQueueRows(req, jcs.map((j) => j.serviceVisitId.toString()))
      rows = rows.filter((r) => visitIds.has(r.serviceVisitId))
    }
  } else {
    rows = rows.filter((r) => !r.jobCardId)
  }

  if (params.search) {
    const q = params.search.toLowerCase()
    rows = rows.filter((r) =>
      [r.bookingNumber, r.visitNumber, r.registration, r.customerName, r.jobCardNumber]
        .some((f) => String(f ?? '').toLowerCase().includes(q)),
    )
  }

  const total = rows.length
  const slice = rows.slice(skip, skip + limit)
  return { items: slice, page, limit, total, totalPages: Math.ceil(total / limit) }
}

async function buildEligibleVisitRows(req: Request) {
  const fins = await FinancialAuthorization.find({
    tenantId: req.tenantId!,
    jobCardAuthorized: true,
    ...(req.branchId && { branchId: req.branchId }),
  }).limit(200).lean()

  const visitIds = fins.map((f) => f.serviceVisitId.toString())
  return enrichQueueRows(req, visitIds)
}

async function enrichQueueRows(req: Request, visitIds: string[]) {
  const rows = []
  for (const visitId of visitIds) {
    const visit = await ServiceVisit.findById(visitId).populate('customerId').populate('vehicleId').lean()
    if (!visit || visit.tenantId.toString() !== req.tenantId!) continue
    if (req.branchId && visit.branchId.toString() !== req.branchId) continue

    const [booking, estimate, inspection, voc, fin, jc, approval, advance] = await Promise.all([
      visit.bookingId ? Booking.findById(visit.bookingId).lean() : null,
      Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean(),
      InspectionCase.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean(),
      VocRecord.findOne({ tenantId: req.tenantId!, visitId: visitId }).lean(),
      FinancialAuthorization.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean(),
      JobCard.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean(),
      CustomerApproval.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).sort({ recordedAt: -1 }).lean(),
      AdvancePayment.aggregate([
        { $match: { tenantId: visit.tenantId, serviceVisitId: visit._id, verificationStatus: 'CONFIRMED' } },
        { $group: { _id: null, total: { $sum: '$receivedAmount' } } },
      ]),
    ])

    const rev = estimate ? currentRevision(estimate) : undefined
    const approvedItems = (rev?.items ?? []).filter(
      (i) => i.customerApprovalStatus === 'APPROVED' || estimate?.status === 'CUSTOMER_APPROVED',
    )
    const customer = visit.customerId as { name?: string; mobile?: string }
    const vehicle = visit.vehicleId as { registrationNo?: string; make?: string; model?: string }

    const assignments = jc
      ? await WorkAssignment.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean()
      : []

    rows.push({
      serviceVisitId: visitId,
      bookingNumber: booking?.bookingNumber,
      visitNumber: visit.visitNumber,
      jobCardId: jc?._id.toString(),
      jobCardNumber: jc?.jobCardNumber,
      jobCardStatus: jc?.status,
      registration: vehicle?.registrationNo,
      vehicleMakeModel: `${vehicle?.make ?? ''} ${vehicle?.model ?? ''}`.trim(),
      customerName: customer?.name,
      customerMobile: customer?.mobile,
      bookingType: booking?.bookingType,
      gateInAt: visit.stageLogs?.find((s) => s.stage === 'ARRIVAL')?.completedAt,
      vocSummary: voc?.complaints?.[0]?.description ?? booking?.customerComplaint,
      inspectionReference: inspection?.inspectionNumber,
      estimateNumber: estimate?.estimateNumber,
      estimateRevision: estimate?.currentRevisionNumber,
      approvedEstimateValue: approval?.approvedAmount ?? rev?.totals?.finalAmount,
      financialAuthorizationStatus: fin?.financialAuthStatus,
      advanceReceived: advance[0]?.total ?? 0,
      approvedWorkItemCount: approvedItems.length,
      assignedTeams: assignments.map((a) => a.teamId?.toString()).filter(Boolean),
      plannedDelivery: jc?.customerPromisedDelivery ?? jc?.deliveryPlan?.committedDelivery,
      eligible: !jc || jc.status === 'CANCELLED',
    })
  }
  return rows
}

export async function createJobCardFromVisit(req: Request, visitId: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const dup = await JobCard.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return { jobCard: dup, duplicate: true }
  }

  const eligibility = await assertEligibleForJobCard(req.tenantId!, visitId, req.branchId)
  if (!eligibility.eligible) {
    throw new ValidationError(eligibility.reasons.join('; '))
  }

  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! })
  if (!visit) throw new NotFoundError('Visit not found')

  const estimate = await Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId })
  if (!estimate) throw new ValidationError('Estimate missing')
  const rev = currentRevision(estimate)
  const handoff = await estimatesService.getJobCardHandoff(req, estimate._id.toString())

  const approval = await CustomerApproval.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
    estimateRevisionNumber: estimate.currentRevisionNumber,
  }).sort({ recordedAt: -1 })
  const fin = await FinancialAuthorization.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId })

  const jobCardNumber = await generateDocumentNumber(req.tenantId!, 'JOB_CARD')
  const approvedValue = (handoff.approvedItems as Array<{ finalAmount?: number }>).reduce(
    (s, i) => s + (i.finalAmount ?? 0),
    0,
  )

  const jc = await JobCard.create({
    tenantId: req.tenantId!,
    branchId: visit.branchId,
    serviceVisitId: visit._id,
    bookingId: visit.bookingId,
    customerId: visit.customerId,
    vehicleId: visit.vehicleId,
    estimateId: estimate._id,
    approvedEstimateRevisionNumber: estimate.currentRevisionNumber,
    customerApprovalId: approval?._id,
    financialAuthorizationId: fin?._id,
    jobCardNumber,
    approvedValue,
    currentValue: approvedValue,
    status: 'READY_FOR_ASSIGNMENT',
    advisorId: visit.advisorId,
    workshopExecutiveId: req.user?.id,
    idempotencyKey,
    createdBy: req.user?.id,
  })

  visit.jobCardNumber = jobCardNumber
  await visit.save()
  const { onJobCardCreated } = await import('../workflow/workflow-engine.service.js')
  await onJobCardCreated(req, visitId)

  for (const item of handoff.approvedItems as Array<Record<string, unknown>>) {
    await JobWorkItem.create({
      tenantId: req.tenantId!,
      jobCardId: jc._id,
      estimateLineId: String(item.lineId),
      category: String(item.category ?? 'OTHER'),
      description: String(item.description ?? 'Work item'),
      approvedQuantity: Number(item.quantity ?? 1),
      uom: String(item.uom ?? 'NOS'),
      standardLabourHours: Number(item.labourHours ?? 1),
      status: 'PENDING',
    })
  }

  await createAuditLog({
    req,
    module: 'job_cards',
    action: 'CREATED',
    recordId: jc._id.toString(),
    newValue: { visitId, jobCardNumber },
  })

  return { jobCard: jc, duplicate: false }
}

export async function getJobCardWorkspace(req: Request, id: string) {
  const jc = await JobCard.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  if (!jc) throw new NotFoundError('Job card not found')

  const [visit, workItems, assignments, reservations] = await Promise.all([
    ServiceVisit.findById(jc.serviceVisitId).populate('customerId').populate('vehicleId').lean(),
    JobWorkItem.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean(),
    WorkAssignment.find({ tenantId: req.tenantId!, jobCardId: jc._id }).populate('teamId').lean(),
    LocationReservation.find({ tenantId: req.tenantId!, jobCardId: jc._id }).lean(),
  ])

  const estimate = jc.estimateId ? await Estimate.findById(jc.estimateId).lean() : null
  const rev = estimate ? currentRevision(estimate) : undefined

  return {
    jobCard: jc,
    visit,
    estimate: estimate ? { estimateNumber: estimate.estimateNumber, revision: rev, status: estimate.status } : null,
    workItems,
    assignments,
    locationReservations: reservations,
    partsReadiness: [],
  }
}

export async function createAssignment(req: Request, jobCardId: string, body: Record<string, unknown>) {
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const workItemIds = (body.workItemIds as string[]) ?? []
  const items = await JobWorkItem.find({ _id: { $in: workItemIds }, jobCardId: jc._id })
  if (items.length !== workItemIds.length) throw new ValidationError('Invalid work items')

  const assignment = await WorkAssignment.create({
    tenantId: req.tenantId!,
    branchId: jc.branchId,
    jobCardId: jc._id,
    workItemIds,
    teamId: body.teamId,
    serviceAdvisorId: body.serviceAdvisorId ?? jc.advisorId,
    supervisorId: body.supervisorId ?? jc.supervisorId,
    floorInChargeId: body.floorInChargeId ?? jc.floorInChargeId,
    leadMechanicId: body.leadMechanicId,
    mechanicIds: body.mechanicIds ?? [],
    helperIds: body.helperIds ?? [],
    locationId: body.locationId,
    plannedStart: body.plannedStart ? new Date(String(body.plannedStart)) : undefined,
    plannedFinish: body.plannedFinish ? new Date(String(body.plannedFinish)) : undefined,
    plannedLabourHours: body.plannedLabourHours,
    workInstructions: body.workInstructions,
    assignedBy: req.user?.id,
    assignedAt: new Date(),
    status: 'DRAFT',
    history: [{ action: 'CREATED', at: new Date(), by: req.user?.id }],
  })

  for (const wi of items) {
    wi.assignedTeamId = body.teamId as typeof wi.assignedTeamId
    wi.locationId = body.locationId as typeof wi.locationId
    wi.status = 'ASSIGNED'
    await wi.save()
  }

  if (jc.status === 'READY_FOR_ASSIGNMENT') {
    jc.status = 'ASSIGNMENT_IN_PROGRESS'
    await jc.save()
  }

  return assignment
}

export async function releaseAssignment(req: Request, jobCardId: string, assignmentId: string) {
  if (!req.user?.permissions.includes('job_cards.release')) {
    throw new ValidationError('Release permission required')
  }
  const assignment = await WorkAssignment.findOne({
    _id: assignmentId,
    jobCardId,
    tenantId: req.tenantId!,
  })
  if (!assignment) throw new NotFoundError('Assignment not found')
  if (assignment.status === 'RELEASED') return assignment

  assignment.status = 'RELEASED'
  assignment.history.push({ action: 'RELEASED', at: new Date(), by: req.user?.id as unknown as typeof assignment.history[0]['by'] })
  await assignment.save()

  await JobWorkItem.updateMany(
    { _id: { $in: assignment.workItemIds }, jobCardId },
    { $set: { status: 'RELEASED', executionStatus: 'NOT_STARTED' } },
  )

  const jc = await JobCard.findById(jobCardId)
  if (jc && ['READY_FOR_ASSIGNMENT', 'ASSIGNMENT_IN_PROGRESS', 'ASSIGNED'].includes(jc.status)) {
    jc.status = 'READY_TO_START'
    await jc.save()
  }

  try {
    const { ensureWipRecordForJobCard } = await import('../wip/wip.service.js')
    await ensureWipRecordForJobCard(req, jobCardId)
  } catch {
    /* eligibility enforced when WIP is opened */
  }

  return assignment
}

export async function updateDeliveryPlan(req: Request, jobCardId: string, body: Record<string, unknown>) {
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const items = await JobWorkItem.find({ jobCardId: jc._id }).lean()
  const labourHours = items.reduce((s, i) => s + (i.standardLabourHours ?? 0), 0)
  const assignments = await WorkAssignment.countDocuments({ jobCardId: jc._id, status: { $ne: 'CANCELLED' } })

  const schedule = calculateDeliverySchedule({
    approvedLabourHours: labourHours,
    parallelTeams: Math.max(1, assignments),
    partsReady: true,
    plannedStart: body.workshopPlannedStart ? new Date(String(body.workshopPlannedStart)) : new Date(),
    bufferHours: 2,
    shiftHoursPerDay: 8,
  })

  const committed = body.customerPromisedDelivery
    ? new Date(String(body.customerPromisedDelivery))
    : schedule.suggestedDelivery

  const prev = jc.deliveryPlan?.committedDelivery ?? jc.customerPromisedDelivery
  if (!jc.deliveryPlan) {
    jc.set('deliveryPlan', {})
  }
  const dp = jc.deliveryPlan!
  dp.customerRequestedDelivery = body.customerRequestedDelivery
    ? new Date(String(body.customerRequestedDelivery))
    : dp.customerRequestedDelivery
  dp.workshopPlannedStart = body.workshopPlannedStart
    ? new Date(String(body.workshopPlannedStart))
    : new Date()
  dp.estimatedLabourHours = labourHours
  dp.earliestFeasibleCompletion = schedule.earliestFeasibleCompletion
  dp.suggestedDelivery = schedule.suggestedDelivery
  dp.committedDelivery = committed
  dp.commitmentSetBy = req.user?.id as unknown as typeof dp.commitmentSetBy
  dp.commitmentSetAt = new Date()
  dp.deliveryRemarks = body.deliveryRemarks as string | undefined
  dp.delayRisk = schedule.delayRisk
  dp.requiresManagerConfirmation = schedule.requiresManagerConfirmation
  if (prev && committed && prev.getTime() !== committed.getTime()) {
    dp.revisionHistory.push({
      previousPromise: prev,
      newPromise: committed,
      reason: String(body.revisionReason ?? 'Updated'),
      revisedBy: req.user?.id,
      revisedAt: new Date(),
    })
  }
  jc.customerPromisedDelivery = committed
  jc.internalTargetCompletion = schedule.earliestFeasibleCompletion
  jc.workPlannedStart = dp.workshopPlannedStart
  await jc.save()

  return { jobCard: jc, schedule }
}

export async function getJobCardPdf(req: Request, id: string) {
  const workspace = await getJobCardWorkspace(req, id)
  const jc = workspace.jobCard as {
    jobCardNumber: string
    instructions?: string
    customerPromisedDelivery?: Date
    internalTargetCompletion?: Date
    deliveryPlan?: { committedDelivery?: Date }
  }
  const visit = workspace.visit as {
    visitNumber?: string
    customerId?: { name?: string; mobile?: string }
    vehicleId?: { registrationNo?: string; make?: string; model?: string }
  }
  const [tenant, branch, approval] = await Promise.all([
    Tenant.findById(req.tenantId!).lean(),
    Branch.findById((workspace.jobCard as { branchId: unknown }).branchId).lean(),
    CustomerApproval.findById((workspace.jobCard as { customerApprovalId?: unknown }).customerApprovalId).lean(),
  ])

  const teams = await Promise.all(
    (workspace.assignments as Array<{ teamId?: { name?: string } }>).map(async (a) => ({
      name: (a.teamId as { name?: string })?.name ?? 'Team',
      members: '',
    })),
  )

  const buffer = await generateJobCardPdfBuffer({
    tenantName: tenant?.name ?? 'Workshop',
    branchName: branch?.name ?? '',
    jobCardNumber: jc.jobCardNumber,
    visitNumber: visit?.visitNumber ?? '',
    customerName: visit?.customerId?.name ?? '',
    customerMobile: visit?.customerId?.mobile,
    registrationNo: visit?.vehicleId?.registrationNo ?? '',
    vehicleMakeModel: `${visit?.vehicleId?.make ?? ''} ${visit?.vehicleId?.model ?? ''}`.trim(),
    estimateNumber: (workspace.estimate as { estimateNumber?: string })?.estimateNumber,
    approvalReference: approval?.approvalReference,
    financialAuthStatus: undefined,
    workItems: (workspace.workItems as Array<{ description: string; category?: string; standardLabourHours?: number }>).map((w) => ({
      description: w.description,
      category: w.category,
      hours: w.standardLabourHours,
    })),
    teams,
    locations: (workspace.locationReservations as unknown[]).map(() => 'Reserved'),
    promisedDelivery: jc.customerPromisedDelivery?.toISOString(),
    internalTarget: jc.internalTargetCompletion?.toISOString(),
    instructions: jc.instructions,
  })

  return { buffer, filename: `${jc.jobCardNumber}.pdf` }
}
