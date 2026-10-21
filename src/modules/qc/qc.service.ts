import type { Request } from 'express'
import {
  Booking,
  Branch,
  JobCard,
  JobWorkItem,
  QCAttempt,
  QCReworkRequest,
  QualityControlCase,
  Role,
  ServiceVisit,
  Tenant,
  User,
  Vehicle,
  VocRecord,
  WipRecord,
  WorkAssignment,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { assertEligibleForQc } from './qc-eligibility.js'
import { buildQuantitySnapshots } from './qc-quantity.js'
import { DEFAULT_ROAD_TEST_CHECKLIST } from './qc-road-test-template.js'
import { generateQcPdfBuffer } from './qc-pdf.service.js'
import type { QcQueueTab } from '../../types/enums.js'

export async function ensureQcCaseForJobCard(req: Request, jobCardId: string) {
  const eligibility = await assertEligibleForQc(req.tenantId!, jobCardId)
  if (!eligibility.eligible) throw new ValidationError(eligibility.reasons.join('; '))

  let qcCase = await QualityControlCase.findOne({ tenantId: req.tenantId!, jobCardId })
  if (qcCase) return qcCase

  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const wip = await WipRecord.findOne({ jobCardId: jc._id })
  const qcReference = await generateDocumentNumber(req.tenantId!, 'QUALITY_CONTROL')
  qcCase = await QualityControlCase.create({
    tenantId: req.tenantId!,
    branchId: jc.branchId,
    serviceVisitId: jc.serviceVisitId,
    jobCardId: jc._id,
    qcReference,
    jobCardRevisionNumber: jc.revisionNumber ?? 1,
    status: 'AWAITING_QC',
    workCompletionAt: wip?.completedAt ?? new Date(),
  })
  return qcCase
}

export async function listEligibleInspectors(req: Request) {
  const roles = await Role.find({
    tenantId: req.tenantId!,
    code: { $in: ['INSPECTOR', 'WORKSHOP_MANAGER'] },
  }).lean()
  const roleIds = roles.map((r) => r._id)
  const filter: Record<string, unknown> = {
    tenantId: req.tenantId!,
    isActive: true,
    $or: [{ roleId: { $in: roleIds } }, { 'workshopProfile.qcQualification': { $exists: true, $ne: '' } }],
  }
  if (req.branchId) filter.branchIds = { $in: [req.branchId] }

  const users = await User.find(filter).limit(100).lean()
  return users.map((u) => ({
    id: u._id.toString(),
    employeeCode: u.employeeCode,
    name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
    inspectorCode: (u.workshopProfile as { inspectorCode?: string })?.inspectorCode,
    roadTestAuthorized: (u.workshopProfile as { roadTestAuthorized?: boolean })?.roadTestAuthorized ?? false,
    availability: (u.workshopProfile as { availabilityStatus?: string })?.availabilityStatus ?? 'AVAILABLE',
    licenceExpiry: (u.workshopProfile as { drivingLicenceExpiry?: Date })?.drivingLicenceExpiry,
  }))
}

function tabFilter(tab: QcQueueTab) {
  return { status: tab }
}

export async function getQcDashboard(req: Request) {
  const tenantId = req.tenantId!
  const branchFilter: Record<string, unknown> = { tenantId }
  if (req.branchId) branchFilter.branchId = req.branchId
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [awaiting, assigned, inProgress, passedToday, failedToday, rework, reinspect, overdue, invoiceReady] =
    await Promise.all([
      QualityControlCase.countDocuments({ ...branchFilter, status: 'AWAITING_QC' }),
      QualityControlCase.countDocuments({ ...branchFilter, status: 'INSPECTOR_ASSIGNED' }),
      QualityControlCase.countDocuments({ ...branchFilter, status: { $in: ['QC_IN_PROGRESS', 'ROAD_TEST_PENDING'] } }),
      QCAttempt.countDocuments({ tenantId, finalDecision: 'PASS', submittedAt: { $gte: todayStart } }),
      QCAttempt.countDocuments({ tenantId, finalDecision: 'FAIL', submittedAt: { $gte: todayStart } }),
      QualityControlCase.countDocuments({ ...branchFilter, status: 'REWORK_IN_PROGRESS' }),
      QualityControlCase.countDocuments({ ...branchFilter, status: 'REINSPECTION_PENDING' }),
      QualityControlCase.countDocuments({
        ...branchFilter,
        status: { $nin: ['QC_PASSED', 'RELEASED_FOR_INVOICE'] },
        plannedQcTime: { $lt: new Date() },
      }),
      QualityControlCase.countDocuments({ ...branchFilter, status: 'RELEASED_FOR_INVOICE' }),
    ])

  return {
    totalAwaitingQc: awaiting,
    assignedVehicles: assigned,
    qcInProgress: inProgress,
    passedToday,
    failedToday,
    reworkPending: rework,
    reinspectionPending: reinspect,
    overdueQc: overdue,
    invoiceReadyVehicles: invoiceReady,
  }
}

export async function getQcQueue(req: Request, params: { tab?: string; search?: string; page?: number; limit?: number }) {
  const tenantId = req.tenantId!
  const tab = (params.tab ?? 'AWAITING_QC') as QcQueueTab
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)

  const jcs = await JobCard.find({ tenantId, status: { $in: ['READY_FOR_QC', 'QC_IN_PROGRESS', 'QC_FAILED', 'QC_PASSED', 'INVOICE_READY'] } }).select('_id')
  for (const jc of jcs) {
    try {
      await ensureQcCaseForJobCard(req, jc._id.toString())
    } catch {
      /* not yet eligible */
    }
  }

  const filter: Record<string, unknown> = { tenantId, ...tabFilter(tab) }
  if (req.branchId) filter.branchId = req.branchId

  const [cases, total] = await Promise.all([
    QualityControlCase.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    QualityControlCase.countDocuments(filter),
  ])

  const items = []
  for (const c of cases) {
    const row = await buildQueueRow(c.jobCardId.toString(), c)
    if (!row) continue
    if (params.search) {
      const q = params.search.toLowerCase()
      if (!`${row.qcReference} ${row.registration} ${row.customerName}`.toLowerCase().includes(q)) continue
    }
    items.push(row)
  }
  return { items, page, limit, total }
}

async function buildQueueRow(jobCardId: string, qcCase: { _id: unknown; qcReference: string; status: string; assignedInspectorId?: unknown; jobCardRevisionNumber?: number }) {
  const jc = await JobCard.findById(jobCardId).populate('customerId').populate('vehicleId').lean()
  if (!jc) return null
  const visit = await ServiceVisit.findById(jc.serviceVisitId).lean()
  const booking = jc.bookingId ? await Booking.findById(jc.bookingId).lean() : null
  const inspector = qcCase.assignedInspectorId ? await User.findById(qcCase.assignedInspectorId).lean() : null
  const attempt = await QCAttempt.findOne({ qcCaseId: qcCase._id }).sort({ attemptNumber: -1 }).lean()
  const customer = jc.customerId as { name?: string } | null
  const vehicle = jc.vehicleId as { registrationNo?: string; make?: string; model?: string } | null

  return {
    qcCaseId: (qcCase._id as { toString: () => string }).toString(),
    qcReference: qcCase.qcReference,
    registration: vehicle?.registrationNo,
    vehicleMakeModel: [vehicle?.make, vehicle?.model].filter(Boolean).join(' '),
    customerName: customer?.name,
    bookingNumber: booking?.bookingNumber ?? visit?.visitNumber,
    jobCardNumber: jc.jobCardNumber,
    jobCardRevision: qcCase.jobCardRevisionNumber ?? jc.revisionNumber ?? 1,
    qcInspector: inspector ? `${inspector.firstName} ${inspector.lastName ?? ''}`.trim() : undefined,
    workCompletionTime: visit?.updatedAt,
    qcStatus: qcCase.status,
    roadTestStatus: attempt?.roadTest?.disposition ?? 'PENDING',
    plannedDelivery: jc.customerPromisedDelivery,
    jobCardId: jc._id.toString(),
  }
}

export async function getQcWorkspace(req: Request, qcCaseId: string) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId: req.tenantId! })
  if (!qcCase) throw new NotFoundError('QC case not found')

  const jc = await JobCard.findById(qcCase.jobCardId).lean()
  const visit = await ServiceVisit.findById(qcCase.serviceVisitId).populate('customerId').populate('vehicleId').lean()
  const workItems = await JobWorkItem.find({ jobCardId: qcCase.jobCardId }).lean()
  const assignments = await WorkAssignment.find({ jobCardId: qcCase.jobCardId }).populate('teamId').lean()
  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId: qcCase.serviceVisitId }).lean()
  const attempts = await QCAttempt.find({ qcCaseId: qcCase._id }).sort({ attemptNumber: 1 }).lean()
  const reworks = await QCReworkRequest.find({ qcCaseId: qcCase._id }).sort({ createdAt: -1 }).lean()
  const currentAttempt = qcCase.currentAttemptId
    ? await QCAttempt.findById(qcCase.currentAttemptId).lean()
    : attempts[attempts.length - 1]

  const quantityPreview = await buildQuantitySnapshots(req.tenantId!, qcCase.jobCardId.toString())

  return {
    qcCase,
    jobCard: jc,
    visit,
    customer: visit?.customerId,
    vehicle: visit?.vehicleId,
    workItems,
    assignments,
    voc,
    attempts,
    reworks,
    currentAttempt,
    quantityPreview,
  }
}

async function validateInspector(req: Request, inspectorId: string, roadTest = false) {
  const user = await User.findOne({ _id: inspectorId, tenantId: req.tenantId!, isActive: true })
  if (!user) throw new ValidationError('Inspector not active or not found')
  const wp = user.workshopProfile as {
    roadTestAuthorized?: boolean
    drivingLicenceExpiry?: Date
    employmentStatus?: string
  }
  if (wp?.employmentStatus === 'INACTIVE') throw new ValidationError('Inspector inactive')
  if (roadTest) {
    if (!wp?.roadTestAuthorized) throw new ValidationError('Inspector not authorized for road test')
    if (wp.drivingLicenceExpiry && wp.drivingLicenceExpiry < new Date()) {
      throw new ValidationError('Driving licence expired')
    }
  }
  return user
}

export async function assignInspector(req: Request, qcCaseId: string, body: { inspectorId: string; plannedQcTime?: string; priority?: string; specialInstructions?: string }) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId: req.tenantId! })
  if (!qcCase) throw new NotFoundError('QC case not found')
  await validateInspector(req, body.inspectorId)

  if (qcCase.assignedInspectorId) {
    qcCase.assignmentHistory.push({
      inspectorId: qcCase.assignedInspectorId,
      assignedBy: req.user?.id as unknown as typeof qcCase.assignedInspectorId,
      at: new Date(),
      reason: 'Reassigned',
    })
  }

  qcCase.assignedInspectorId = body.inspectorId as unknown as typeof qcCase.assignedInspectorId
  qcCase.assignedBy = req.user?.id as unknown as typeof qcCase.assignedBy
  qcCase.assignedAt = new Date()
  qcCase.plannedQcTime = body.plannedQcTime ? new Date(body.plannedQcTime) : qcCase.plannedQcTime
  qcCase.priority = body.priority
  qcCase.specialInstructions = body.specialInstructions
  qcCase.status = 'INSPECTOR_ASSIGNED'
  await qcCase.save()
  return qcCase
}

async function createAttempt(req: Request, qcCase: typeof QualityControlCase.prototype) {
  const attemptNumber = (qcCase.currentAttemptNumber ?? 0) + 1
  const workItems = await JobWorkItem.find({ jobCardId: qcCase.jobCardId, executionStatus: { $ne: 'CANCELLED' } })
  const workChecks = workItems.map((wi) => ({
    jobWorkItemId: wi._id,
    workDescription: wi.description,
    workPerformed: wi.workDoneDescription,
    checkpoint: 'Repair quality',
    expectedStandard: 'Per approved scope',
    result: 'NOT_TESTED',
    required: true,
  }))

  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId: qcCase.serviceVisitId })
  const vocChecks = (voc?.complaints ?? []).map((c: { _id?: unknown; description?: string }) => ({
    vocComplaintId: c._id?.toString(),
    originalDescription: c.description,
    resolutionStatus: 'FURTHER_VERIFICATION_REQUIRED',
  }))

  const quantityLines = await buildQuantitySnapshots(req.tenantId!, qcCase.jobCardId.toString())

  const prev = await QCAttempt.findOne({ qcCaseId: qcCase._id }).sort({ attemptNumber: -1 })

  const attempt = await QCAttempt.create({
    tenantId: req.tenantId!,
    qcCaseId: qcCase._id,
    attemptNumber,
    previousAttemptId: prev?._id,
    inspectorId: qcCase.assignedInspectorId ?? req.user?.id,
    jobCardRevisionNumber: qcCase.jobCardRevisionNumber,
    status: 'IN_PROGRESS',
    startedAt: new Date(),
    workChecks,
    quantityLines,
    vocChecks,
    roadTest: {
      disposition: 'PENDING',
      checklist: DEFAULT_ROAD_TEST_CHECKLIST.map((c) => ({ ...c, result: 'NOT_TESTED' })),
    },
  })

  qcCase.currentAttemptNumber = attemptNumber
  qcCase.currentAttemptId = attempt._id
  qcCase.status = 'QC_IN_PROGRESS'
  await qcCase.save()

  const jc = await JobCard.findById(qcCase.jobCardId)
  if (jc) {
    jc.status = 'QC_IN_PROGRESS'
    await jc.save()
  }
  return attempt
}

export async function startQc(req: Request, qcCaseId: string) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId: req.tenantId! })
  if (!qcCase) throw new NotFoundError('QC case not found')
  if (!qcCase.assignedInspectorId && !req.user?.permissions.includes('qc.assign')) {
    throw new ValidationError('Assign an inspector before starting QC')
  }
  if (!qcCase.assignedInspectorId) qcCase.assignedInspectorId = req.user?.id as unknown as typeof qcCase.assignedInspectorId
  return createAttempt(req, qcCase)
}

export async function updateChecklist(req: Request, qcCaseId: string, body: { workChecks?: unknown[] }) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  if (body.workChecks) attempt.workChecks = body.workChecks as typeof attempt.workChecks
  await attempt.save()
  return attempt
}

export async function updateQuantityVerification(req: Request, qcCaseId: string, body: { quantityLines?: unknown[] }) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  if (body.quantityLines) attempt.quantityLines = body.quantityLines as typeof attempt.quantityLines
  await attempt.save()
  return attempt
}

export async function updateVocVerification(req: Request, qcCaseId: string, body: { vocChecks?: unknown[] }) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  if (body.vocChecks) attempt.vocChecks = body.vocChecks as typeof attempt.vocChecks
  await attempt.save()
  return attempt
}

export async function updateRoadTest(req: Request, qcCaseId: string, body: Record<string, unknown>) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  const disposition = String(body.disposition ?? attempt.roadTest?.disposition ?? 'PENDING')
  if (disposition === 'NOT_SAFE' && !body.exceptionReason) {
    throw new ValidationError('Reason required when road test is not safe')
  }
  if (['COMPLETED', 'REQUIRED'].includes(disposition)) {
    const driverId = String(body.authorizedDriverId ?? attempt.inspectorId)
    await validateInspector(req, driverId, true)
  }
  const startOdo = body.startOdometer != null ? Number(body.startOdometer) : attempt.roadTest?.startOdometer
  const endOdo = body.endOdometer != null ? Number(body.endOdometer) : attempt.roadTest?.endOdometer
  if (startOdo != null && endOdo != null && endOdo < startOdo) {
    throw new ValidationError('End odometer cannot be less than start odometer')
  }
  attempt.roadTest = { ...attempt.roadTest, ...body, disposition } as typeof attempt.roadTest
  await attempt.save()
  const qcCase = await QualityControlCase.findById(qcCaseId)
  if (qcCase && disposition === 'REQUIRED') qcCase.status = 'ROAD_TEST_PENDING'
  else if (qcCase && disposition === 'COMPLETED') qcCase.status = 'QC_IN_PROGRESS'
  await qcCase?.save()
  return attempt
}

async function getEditableAttempt(qcCaseId: string, tenantId: string) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId })
  if (!qcCase?.currentAttemptId) throw new ValidationError('Start QC to create an attempt')
  const attempt = await QCAttempt.findById(qcCase.currentAttemptId)
  if (!attempt || attempt.locked) throw new ValidationError('Attempt is locked or missing')
  return attempt
}

function validateAttemptForSubmit(attempt: typeof QCAttempt.prototype) {
  const errors: string[] = []
  for (const c of attempt.workChecks ?? []) {
    if (c.required && c.result === 'NOT_TESTED') errors.push(`Work check not verified: ${c.workDescription}`)
    if (c.result === 'FAIL') errors.push(`Failed work check: ${c.workDescription}`)
  }
  for (const v of attempt.vocChecks ?? []) {
    if (v.resolutionStatus === 'NOT_RESOLVED') errors.push(`Unresolved VOC: ${v.originalDescription}`)
  }
  for (const q of attempt.quantityLines ?? []) {
    if (q.blocking && q.result !== 'PASS') errors.push(`Blocking quantity variance: ${q.partNumber}`)
  }
  const rt = attempt.roadTest
  if (rt?.disposition === 'REQUIRED' || rt?.disposition === 'PENDING') {
    errors.push('Road test disposition must be completed or documented with exception')
  }
  if (['NOT_REQUIRED', 'NOT_SAFE', 'NOT_POSSIBLE'].includes(rt?.disposition ?? '') && !rt?.exceptionReason) {
    errors.push('Road test exception requires a documented reason')
  }
  if (rt?.disposition === 'COMPLETED') {
    const fails = (rt.checklist ?? []).filter((i: { result?: string }) => i.result === 'FAIL')
    if (fails.length) errors.push('Road test checklist has failures')
  }
  return errors
}

export async function submitQc(req: Request, qcCaseId: string, body: Record<string, unknown>) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  if (body.inspectorFeedback) {
    attempt.inspectorFeedback = body.inspectorFeedback as typeof attempt.inspectorFeedback
  }
  attempt.submittedAt = new Date()
  await attempt.save()
  return attempt
}

export async function passQc(req: Request, qcCaseId: string, body: Record<string, unknown>) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId: req.tenantId! })
  if (!qcCase) throw new NotFoundError('QC case not found')
  if (qcCase.invoiceReleasedAt) return { qcCase, duplicate: true }

  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  const blockers = validateAttemptForSubmit(attempt)
  if (blockers.length) throw new ValidationError(blockers.join('; '))

  attempt.finalDecision = 'PASS'
  attempt.inspectorFeedback = {
    ...(attempt.inspectorFeedback ?? {}),
    finalDecision: 'PASS',
    inspectorRemarks: body.remarks as string,
  } as typeof attempt.inspectorFeedback
  attempt.locked = true
  attempt.submittedAt = new Date()
  await attempt.save()

  qcCase.status = 'QC_PASSED'
  await qcCase.save()

  await releaseInvoiceEligibility(req, qcCase)
  await createAuditLog({ req, module: 'qc', action: 'PASS', recordId: qcCaseId })
  return { qcCase, attempt }
}

export async function failQc(req: Request, qcCaseId: string, body: { remarks?: string; createRework?: boolean }) {
  const attempt = await getEditableAttempt(qcCaseId, req.tenantId!)
  attempt.finalDecision = 'FAIL'
  attempt.locked = true
  attempt.submittedAt = new Date()
  await attempt.save()

  const qcCase = await QualityControlCase.findById(qcCaseId)
  if (qcCase) {
    qcCase.status = 'QC_FAILED'
    await qcCase.save()
    const jc = await JobCard.findById(qcCase.jobCardId)
    if (jc) {
      jc.status = 'QC_FAILED'
      await jc.save()
    }
  }

  if (body.createRework !== false && qcCase) {
    await createReworkFromFail(req, qcCase, attempt, body.remarks)
  }
  return { attempt, qcCase }
}

async function createReworkFromFail(
  req: Request,
  qcCase: typeof QualityControlCase.prototype,
  attempt: typeof QCAttempt.prototype,
  remarks?: string,
) {
  const failedIds = (attempt.workChecks ?? [])
    .filter((c: { result?: string }) => c.result === 'FAIL')
    .map((c: { jobWorkItemId?: unknown }) => c.jobWorkItemId)
  const reworkNumber = await generateDocumentNumber(req.tenantId!, 'QC_REWORK')
  const rework = await QCReworkRequest.create({
    tenantId: req.tenantId!,
    branchId: qcCase.branchId,
    qcCaseId: qcCase._id,
    qcAttemptId: attempt._id,
    jobCardId: qcCase.jobCardId,
    reworkNumber,
    workItemIds: failedIds.length ? failedIds : undefined,
    defectDescription: remarks ?? 'QC failed',
    status: 'OPEN',
    createdBy: req.user?.id,
  })

  if (failedIds.length) {
    await JobWorkItem.updateMany(
      { _id: { $in: failedIds } },
      { $set: { executionStatus: 'REWORK_REQUIRED', workCompleted: false } },
    )
  }

  await WipRecord.updateOne(
    { jobCardId: qcCase.jobCardId },
    { $set: { status: 'IN_PROGRESS' } },
  )
  qcCase.status = 'REWORK_IN_PROGRESS'
  await qcCase.save()

  const jc = await JobCard.findById(qcCase.jobCardId)
  if (jc) {
    jc.status = 'IN_PROGRESS'
    await jc.save()
  }
  return rework
}

export async function createReworkRequest(req: Request, qcCaseId: string, body: Record<string, unknown>) {
  const qcCase = await QualityControlCase.findOne({ _id: qcCaseId, tenantId: req.tenantId! })
  if (!qcCase?.currentAttemptId) throw new ValidationError('No QC attempt')
  const attempt = await QCAttempt.findById(qcCase.currentAttemptId)
  if (!attempt) throw new NotFoundError('Attempt not found')
  return createReworkFromFail(req, qcCase, attempt, body.remarks as string)
}

async function releaseInvoiceEligibility(req: Request, qcCase: typeof QualityControlCase.prototype) {
  if (qcCase.invoiceReleasedAt) return
  qcCase.status = 'RELEASED_FOR_INVOICE'
  qcCase.invoiceReleasedAt = new Date()
  await qcCase.save()

  const jc = await JobCard.findById(qcCase.jobCardId)
  if (jc) {
    jc.status = 'INVOICE_READY'
    await jc.save()
  }

  const visit = await ServiceVisit.findById(qcCase.serviceVisitId)
  if (visit) {
    visit.invoiceReady = true
    visit.qcPassedAt = new Date()
    visit.currentStage = 'INVOICE'
    const attempt = await QCAttempt.findById(qcCase.currentAttemptId)
    if (attempt?.roadTest?.endOdometer != null) visit.finalQcOdometer = attempt.roadTest.endOdometer
    const log = visit.stageLogs?.find((l) => l.stage === 'QC')
    if (log) {
      log.status = 'COMPLETED'
      log.completedAt = new Date()
    }
    const invLog = visit.stageLogs?.find((l) => l.stage === 'INVOICE')
    if (invLog) invLog.status = 'CURRENT'
    await visit.save()
    const { onQcPassed } = await import('../workflow/workflow-engine.service.js')
    await onQcPassed(req, visit._id.toString())
  }

}

export async function createFromJobCard(req: Request, jobCardId: string) {
  const qcCase = await ensureQcCaseForJobCard(req, jobCardId)
  return { qcCase }
}

export async function getQcPdf(req: Request, qcCaseId: string) {
  const workspace = await getQcWorkspace(req, qcCaseId)
  const tenant = await Tenant.findById(req.tenantId!).lean()
  const branch = await Branch.findById(workspace.qcCase.branchId).lean()
  const attempt = workspace.currentAttempt as {
    attemptNumber?: number
    workChecks?: Array<{ workDescription?: string; result?: string }>
    roadTest?: { endOdometer?: number }
    inspectorFeedback?: { inspectorRemarks?: string }
    finalDecision?: string
  } | null
  const customer = workspace.customer as { name?: string; mobile?: string } | null
  const vehicle = workspace.vehicle as { registrationNo?: string; make?: string; model?: string } | null
  const visit = workspace.visit as { odometer?: number } | null
  const inspector = workspace.qcCase.assignedInspectorId
    ? await User.findById(workspace.qcCase.assignedInspectorId).lean()
    : null

  const buffer = await generateQcPdfBuffer({
    tenantName: tenant?.name ?? 'Workshop',
    branchName: branch?.name ?? '',
    qcReference: workspace.qcCase.qcReference,
    attemptNumber: attempt?.attemptNumber ?? 1,
    jobCardNumber: (workspace.jobCard as { jobCardNumber: string }).jobCardNumber,
    customerName: customer?.name ?? '—',
    customerMobile: customer?.mobile,
    registrationNo: vehicle?.registrationNo ?? '—',
    vehicleMakeModel: [vehicle?.make, vehicle?.model].filter(Boolean).join(' '),
    gateInOdometer: visit?.odometer,
    finalRoadTestOdometer: attempt?.roadTest?.endOdometer,
    decision: attempt?.finalDecision ?? 'PENDING',
    inspectorName: inspector ? `${inspector.firstName} ${inspector.lastName ?? ''}`.trim() : '—',
    reportDate: new Date().toLocaleDateString(),
    workChecks: (attempt?.workChecks ?? []).map((w) => ({
      description: w.workDescription ?? '',
      result: w.result ?? 'NOT_TESTED',
    })),
    quantitySummary: `${(attempt as { quantityLines?: unknown[] })?.quantityLines?.length ?? 0} lines verified`,
    vocSummary: `${(attempt as { vocChecks?: unknown[] })?.vocChecks?.length ?? 0} complaints reviewed`,
    roadTestSummary: attempt?.roadTest?.endOdometer != null ? 'Completed' : 'See disposition',
    remarks: attempt?.inspectorFeedback?.inspectorRemarks,
  })
  return buffer
}

export async function invalidateQcForJobCardRevision(tenantId: string, jobCardId: string) {
  const qcCase = await QualityControlCase.findOne({ tenantId, jobCardId })
  if (!qcCase || qcCase.status === 'RELEASED_FOR_INVOICE') return
  if (['QC_PASSED', 'RELEASED_FOR_INVOICE'].includes(qcCase.status)) {
    qcCase.invalidatedByRevision = true
    qcCase.status = 'REINSPECTION_PENDING'
    await qcCase.save()
  }
}
