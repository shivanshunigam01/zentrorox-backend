import {
  Booking,
  InspectionCase,
  MasterData,
  ReceivingRecord,
  Role,
  ServiceVisit,
  User,
  VocRecord,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { createAuditLog } from '../../utils/audit.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors.js'
import {
  INSPECTION_CASE_STATUSES,
  SERVICE_STAGES,
  type InspectionCaseStatus,
  type ServiceStage,
} from '../../types/enums.js'
import { assertEligibleForInspection, assertVisitEligible, loadVisitEligibilityContext } from './inspection-eligibility.js'
import { buildChecklistSnapshot } from './inspection-checklist.js'
import type { Request } from 'express'
import type { Types } from 'mongoose'

const ACTIVE_STATUSES: InspectionCaseStatus[] = [
  'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'AWAITING_REVIEW', 'REWORK_REQUIRED',
]

function tenantFilter(req: Request) {
  return {
    tenantId: req.tenantId!,
    ...(req.branchId && { branchId: req.branchId }),
  }
}

function isEligibleQuiet(
  receiving: { receivingStatus?: string; exceptionFlags?: string[] } | null,
  voc: { confirmationStatus?: string; complaints?: Array<{ isPreventiveMaintenance?: boolean }> } | null,
) {
  try {
    assertEligibleForInspection(receiving, voc)
    return true
  } catch {
    return false
  }
}

export async function syncEligibleInspectionCases(req: Request) {
  const tenantId = req.tenantId!
  const branchId = req.branchId

  const receivingRows = await ReceivingRecord.find({
    tenantId,
    ...(branchId && { branchId }),
    receivingStatus: { $in: ['COMPLETED', 'EXCEPTION'] },
  }).select('visitId receivingStatus exceptionFlags').lean()

  let created = 0
  for (const row of receivingRows) {
    if (!isEligibleQuiet(row, null)) {
      const voc = await VocRecord.findOne({ tenantId, visitId: row.visitId }).lean()
      if (!isEligibleQuiet(row, voc)) continue
    } else {
      const voc = await VocRecord.findOne({ tenantId, visitId: row.visitId }).lean()
      if (!isEligibleQuiet(row, voc)) continue
    }

    const existing = await InspectionCase.findOne({ tenantId, serviceVisitId: row.visitId }).lean()
    if (existing) continue

    try {
      await createInspectionCaseFromVisit(req, row.visitId.toString(), { skipEligibility: false })
      created++
    } catch {
      // visit may lack VOC yet
    }
  }
  return created
}

async function getBranchCode(tenantId: string, branchId: Types.ObjectId) {
  const { Branch } = await import('../../models/index.js')
  const branch = await Branch.findOne({ _id: branchId, tenantId }).lean()
  return branch?.code
}

export async function createInspectionCaseFromVisit(
  req: Request,
  visitId: string,
  opts?: { skipEligibility?: boolean },
) {
  const tenantId = req.tenantId!
  const existing = await InspectionCase.findOne({ tenantId, serviceVisitId: visitId })
  if (existing) {
    return mapInspectionCase(existing)
  }

  const ctx = opts?.skipEligibility
    ? await loadVisitEligibilityContext(req, visitId)
    : await assertVisitEligible(req, visitId)

  const visit = ctx.visit
  const vehicle = visit.vehicleId as {
    _id: Types.ObjectId
    vehicleCategory?: string
    registrationNo?: string
  }
  const branchCode = await getBranchCode(tenantId, visit.branchId as Types.ObjectId)
  const inspectionNumber = await generateDocumentNumber(tenantId, 'INSPECTION', branchCode)

  const snapshot = await buildChecklistSnapshot(tenantId, vehicle?.vehicleCategory)
  const caseDoc = await InspectionCase.create({
    tenantId,
    branchId: visit.branchId,
    inspectionNumber,
    serviceVisitId: visit._id,
    bookingId: visit.bookingId,
    vehicleId: visit.vehicleId,
    customerId: visit.customerId,
    status: 'PENDING_ASSIGNMENT',
    checklistSnapshot: snapshot,
    checklistResponses: [],
    vocVerifications: (ctx.voc?.complaints ?? []).map((c, idx) => {
      const row = c as { _id?: Types.ObjectId; complaintId?: string }
      const complaintId = row.complaintId ?? row._id?.toString() ?? `voc-${idx}`
      return { complaintId, status: 'NOT_CHECKED' as const }
    }),
  })

  await createAuditLog({
    tenantId,
    userId: req.user?.id,
    module: 'inspections',
    action: 'CREATE_CASE',
    recordId: caseDoc._id.toString(),
    req,
  })

  return mapInspectionCase(caseDoc)
}

function mapInspectionCase(doc: {
  _id: Types.ObjectId
  inspectionNumber: string
  status: string
  priority?: string
  inspectorId?: Types.ObjectId | null
  serviceVisitId: Types.ObjectId
  plannedInspectionAt?: Date | null
  startedAt?: Date | null
  submittedAt?: Date | null
  approvedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}) {
  return {
    id: doc._id.toString(),
    inspectionNumber: doc.inspectionNumber,
    status: doc.status,
    priority: doc.priority ?? 'NORMAL',
    inspectorId: doc.inspectorId?.toString(),
    serviceVisitId: doc.serviceVisitId.toString(),
    plannedInspectionAt: doc.plannedInspectionAt,
    startedAt: doc.startedAt,
    submittedAt: doc.submittedAt,
    approvedAt: doc.approvedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export async function getInspectionDashboard(req: Request) {
  await syncEligibleInspectionCases(req)
  const filter = tenantFilter(req)
  const counts: Record<string, number> = {
    awaitingAssignment: 0,
    assigned: 0,
    inProgress: 0,
    awaitingReview: 0,
    reworkRequired: 0,
    completed: 0,
    overdue: 0,
  }

  const rows = await InspectionCase.find(filter).select('status plannedInspectionAt updatedAt').lean()
  const now = Date.now()
  for (const row of rows) {
    if (row.status === 'PENDING_ASSIGNMENT') counts.awaitingAssignment++
    else if (row.status === 'ASSIGNED') counts.assigned++
    else if (row.status === 'IN_PROGRESS' || row.status === 'PAUSED') counts.inProgress++
    else if (row.status === 'AWAITING_REVIEW') counts.awaitingReview++
    else if (row.status === 'REWORK_REQUIRED') counts.reworkRequired++
    else if (row.status === 'COMPLETED') counts.completed++

    const planned = row.plannedInspectionAt ? new Date(row.plannedInspectionAt).getTime() : null
    if (
      planned
      && planned < now
      && ACTIVE_STATUSES.includes(row.status as InspectionCaseStatus)
    ) {
      counts.overdue++
    }
  }

  return counts
}

interface QueueParams {
  status?: InspectionCaseStatus
  search?: string
  inspectorId?: string
  priority?: string
  page?: number
  limit?: number
}

export async function getInspectionQueue(req: Request, params: QueueParams) {
  await syncEligibleInspectionCases(req)
  const filter = tenantFilter(req) as Record<string, unknown>
  if (params.status) filter.status = params.status
  if (params.inspectorId) filter.inspectorId = params.inspectorId
  if (params.priority) filter.priority = params.priority

  const page = Math.max(1, params.page ?? 1)
  const limit = Math.min(100, params.limit ?? 25)
  const skip = (page - 1) * limit

  let cases = await InspectionCase.find(filter)
    .populate('inspectorId', 'firstName lastName email')
    .populate('serviceVisitId', 'visitNumber odometer fuelLevel currentStage')
    .populate('vehicleId', 'registrationNo make model variant vehicleCategory')
    .populate('customerId', 'name mobile')
    .populate('bookingId', 'bookingNumber bookingType')
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean()

  if (params.search?.trim()) {
    const q = params.search.trim().toLowerCase()
    cases = cases.filter((c) => {
      const vehicle = c.vehicleId as { registrationNo?: string; make?: string; model?: string } | null
      const customer = c.customerId as { name?: string; mobile?: string } | null
      const booking = c.bookingId as { bookingNumber?: string } | null
      const visit = c.serviceVisitId as { visitNumber?: string } | null
      const hay = [
        c.inspectionNumber,
        vehicle?.registrationNo,
        vehicle?.make,
        vehicle?.model,
        customer?.name,
        customer?.mobile,
        booking?.bookingNumber,
        visit?.visitNumber,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }

  const visitIds = cases.map((c) => (c.serviceVisitId as { _id: Types.ObjectId })._id ?? c.serviceVisitId)
  const vocRows = await VocRecord.find({ tenantId: req.tenantId!, visitId: { $in: visitIds } }).lean()
  const receivingRows = await ReceivingRecord.find({ tenantId: req.tenantId!, visitId: { $in: visitIds } }).lean()
  const vocByVisit = new Map(vocRows.map((v) => [v.visitId.toString(), v]))
  const recByVisit = new Map(receivingRows.map((r) => [r.visitId.toString(), r]))

  const items = cases.map((c) => {
    const visitId = (c.serviceVisitId as { _id?: Types.ObjectId })._id?.toString()
      ?? (c.serviceVisitId as Types.ObjectId).toString()
    const voc = vocByVisit.get(visitId)
    const receiving = recByVisit.get(visitId)
    const complaints = voc?.complaints ?? []
    const primary = complaints[0] as { description?: string; title?: string } | undefined
    const inspector = c.inspectorId as { firstName?: string; lastName?: string } | null
    const pendingMs = Date.now() - new Date(c.updatedAt).getTime()

    return {
      id: c._id.toString(),
      inspectionReference: c.inspectionNumber,
      bookingNumber: (c.bookingId as { bookingNumber?: string } | null)?.bookingNumber,
      serviceVisitNumber: (c.serviceVisitId as { visitNumber?: string } | null)?.visitNumber,
      vehicleRegistration: (c.vehicleId as { registrationNo?: string } | null)?.registrationNo,
      vehicleCategory: (c.vehicleId as { vehicleCategory?: string } | null)?.vehicleCategory,
      make: (c.vehicleId as { make?: string } | null)?.make,
      model: (c.vehicleId as { model?: string } | null)?.model,
      customerName: (c.customerId as { name?: string } | null)?.name,
      customerMobile: (c.customerId as { mobile?: string } | null)?.mobile,
      bookingType: (c.bookingId as { bookingType?: string } | null)?.bookingType,
      gateInAt: receiving?.observedArrivalAt ?? receiving?.recordedAt,
      gateInOdometer: receiving?.odometer,
      vocComplaintCount: complaints.length,
      primaryComplaint: primary?.title ?? primary?.description,
      priority: c.priority ?? 'NORMAL',
      assignedInspector: inspector ? `${inspector.firstName ?? ''} ${inspector.lastName ?? ''}`.trim() : null,
      inspectorId: c.inspectorId?.toString(),
      inspectorStatus: c.inspectorId ? 'ASSIGNED' : 'UNASSIGNED',
      inspectionStatus: c.status,
      pendingDurationMinutes: Math.floor(pendingMs / 60000),
      serviceVisitId: visitId,
    }
  })

  const total = await InspectionCase.countDocuments(filter)
  return { items, page, limit, total }
}

export async function getInspectionDetail(req: Request, id: string) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
    .populate('inspectorId', 'firstName lastName email')
    .populate('serviceVisitId')
    .populate('vehicleId')
    .populate('customerId')
    .populate('bookingId')
    .lean()
  if (!caseDoc) throw new NotFoundError('Inspection case not found')

  const visitId = (caseDoc.serviceVisitId as { _id: Types.ObjectId })._id.toString()
  const [receiving, voc] = await Promise.all([
    ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId }).lean(),
    VocRecord.findOne({ tenantId: req.tenantId!, visitId }).lean(),
  ])

  return {
    ...caseDoc,
    id: caseDoc._id.toString(),
    receiving,
    voc,
  }
}

async function assertInspectorEligible(req: Request, inspectorId: string) {
  const roles = await Role.find({
    tenantId: req.tenantId!,
    code: { $in: ['INSPECTOR', 'TECHNICIAN', 'WORKSHOP_MANAGER'] },
  }).lean()
  const roleIds = roles.map((r) => r._id)
  const user = await User.findOne({
    _id: inspectorId,
    tenantId: req.tenantId!,
    isActive: true,
    roleId: { $in: roleIds },
  })
  if (!user) throw new ValidationError('Selected inspector is not active or not authorized')
  if (req.branchId && user.branchIds?.length) {
    const allowed = user.branchIds.some((b) => b.toString() === req.branchId)
    if (!allowed) throw new ForbiddenError('Inspector is not assigned to this branch')
  }
  return user
}

export async function listInspectors(req: Request, vehicleCategory?: string) {
  const roles = await Role.find({
    tenantId: req.tenantId!,
    code: { $in: ['INSPECTOR', 'TECHNICIAN', 'WORKSHOP_MANAGER'] },
  }).lean()
  const roleIds = roles.map((r) => r._id)
  const users = await User.find({
    tenantId: req.tenantId!,
    isActive: true,
    roleId: { $in: roleIds },
    ...(req.branchId && { branchIds: req.branchId }),
  })
    .populate('roleId', 'name code')
    .sort({ firstName: 1 })
    .lean()

  const openCounts = await InspectionCase.aggregate([
    { $match: { tenantId: req.tenantId!, status: { $in: ['ASSIGNED', 'IN_PROGRESS', 'PAUSED'] } } },
    { $group: { _id: '$inspectorId', count: { $sum: 1 } } },
  ])
  const workload = new Map(openCounts.map((r) => [r._id?.toString(), r.count as number]))

  return users.map((u) => {
    const role = u.roleId as { name?: string; code?: string } | undefined
    const meta = u.metadata as { inspectionQualifications?: string[]; vehicleCategories?: string[]; availability?: string } | undefined
    const specs = meta?.vehicleCategories ?? []
    const categoryMatch = !vehicleCategory || !specs.length || specs.includes(vehicleCategory)
    return {
      id: u._id.toString(),
      employeeCode: u.employeeCode,
      name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
      mobile: u.mobile,
      email: u.email,
      role: role?.name,
      roleCode: role?.code,
      designations: meta?.inspectionQualifications ?? [],
      vehicleCategorySpecializations: specs,
      availability: meta?.availability ?? 'AVAILABLE',
      activeAssignments: workload.get(u._id.toString()) ?? 0,
      eligible: categoryMatch,
    }
  }).filter((i) => i.eligible)
}

export async function assignInspector(
  req: Request,
  id: string,
  body: {
    inspectorId: string
    priority?: string
    plannedInspectionAt?: string
    assignmentInstructions?: string
    overrideReason?: string
  },
) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  if (!['PENDING_ASSIGNMENT', 'ASSIGNED', 'REWORK_REQUIRED'].includes(caseDoc.status)) {
    throw new ConflictError('Cannot assign inspector in current status')
  }

  await assertInspectorEligible(req, body.inspectorId)

  const historyEntry = {
    inspectorId: body.inspectorId,
    assignedBy: req.user?.id,
    assignedAt: new Date(),
    reason: body.overrideReason,
    previousInspectorId: caseDoc.inspectorId,
  }
  caseDoc.assignmentHistory.push(historyEntry as unknown as typeof caseDoc.assignmentHistory[number])
  caseDoc.inspectorId = body.inspectorId as unknown as typeof caseDoc.inspectorId
  caseDoc.priority = body.priority ?? caseDoc.priority
  if (body.plannedInspectionAt) caseDoc.plannedInspectionAt = new Date(body.plannedInspectionAt)
  caseDoc.assignmentInstructions = body.assignmentInstructions
  caseDoc.status = 'ASSIGNED'
  await caseDoc.save()

  await createAuditLog({
    tenantId: req.tenantId!,
    userId: req.user?.id,
    module: 'inspections',
    action: 'ASSIGN',
    recordId: id,
    newValue: { inspectorId: body.inspectorId },
    req,
  })

  return mapInspectionCase(caseDoc)
}

function assertCanEditInspection(req: Request, caseDoc: { inspectorId?: Types.ObjectId | null; status: string }) {
  const userId = req.user?.id
  const isAssignee = caseDoc.inspectorId?.toString() === userId
  const isManager = req.user?.permissions?.includes('service_visits.edit')
    || req.user?.permissions?.includes('admin.edit')
  if (!isAssignee && !isManager) {
    throw new ForbiddenError('Only assigned inspector or workshop manager can modify this inspection')
  }
  if (['COMPLETED', 'AWAITING_REVIEW'].includes(caseDoc.status) && !isManager) {
    throw new ConflictError('Inspection is locked pending review')
  }
}

export async function startInspection(req: Request, id: string) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  if (!caseDoc.inspectorId) throw new ValidationError('Assign an inspector before starting')
  assertCanEditInspection(req, caseDoc)

  if (!caseDoc.checklistSnapshot?.length) {
    const vehicle = await ServiceVisit.findById(caseDoc.serviceVisitId).populate('vehicleId').lean()
    const v = vehicle?.vehicleId as { vehicleCategory?: string } | undefined
    caseDoc.checklistSnapshot = await buildChecklistSnapshot(req.tenantId!, v?.vehicleCategory) as unknown as typeof caseDoc.checklistSnapshot
  }

  if (!caseDoc.checklistResponses?.length && caseDoc.checklistSnapshot?.length) {
    caseDoc.checklistResponses = caseDoc.checklistSnapshot.map((item) => ({
      snapshotItemId: item._id,
      result: 'NOT_TESTED',
    })) as typeof caseDoc.checklistResponses
  }

  caseDoc.status = 'IN_PROGRESS'
  caseDoc.startedAt = caseDoc.startedAt ?? new Date()
  await caseDoc.save()
  return mapInspectionCase(caseDoc)
}

export async function pauseInspection(req: Request, id: string) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)
  if (caseDoc.status !== 'IN_PROGRESS') throw new ConflictError('Only in-progress inspections can be paused')
  caseDoc.status = 'PAUSED'
  await caseDoc.save()
  return mapInspectionCase(caseDoc)
}

export async function resumeInspection(req: Request, id: string) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)
  if (!['PAUSED', 'REWORK_REQUIRED', 'ASSIGNED'].includes(caseDoc.status)) {
    throw new ConflictError('Inspection cannot be resumed from current status')
  }
  caseDoc.status = 'IN_PROGRESS'
  await caseDoc.save()
  return mapInspectionCase(caseDoc)
}

export async function updateTrial(req: Request, id: string, trial: Record<string, unknown>) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)

  const disposition = trial.disposition as string | undefined
  if (disposition === 'NOT_SAFE' || disposition === 'NOT_POSSIBLE' || disposition === 'NOT_REQUIRED') {
    if (!trial.skipReason && !trial.remarks) {
      throw new ValidationError('Reason required when road trial is skipped or not performed')
    }
  }

  const startOdo = trial.startOdometer as number | undefined
  const endOdo = trial.endOdometer as number | undefined
  if (startOdo != null && endOdo != null && endOdo < startOdo) {
    throw new ValidationError('Ending odometer cannot be less than starting odometer')
  }

  caseDoc.trial = { ...(caseDoc.trial ?? {}), ...trial, status: 'DRAFT' } as typeof caseDoc.trial
  await caseDoc.save()
  return caseDoc.trial
}

export async function updateChecklist(req: Request, id: string, responses: Array<Record<string, unknown>>) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)

  const now = new Date()
  const byId = new Map((caseDoc.checklistResponses ?? []).map((r) => [r.snapshotItemId?.toString(), r]))

  for (const row of responses) {
    const key = String(row.snapshotItemId)
    const existing = byId.get(key)
    const patch = {
      ...existing,
      ...row,
      checkedBy: req.user?.id,
      checkedAt: now,
    }
    byId.set(key, patch as typeof existing & Record<string, unknown>)
  }

  caseDoc.checklistResponses = Array.from(byId.values()) as typeof caseDoc.checklistResponses
  await caseDoc.save()
  return { checklistSnapshot: caseDoc.checklistSnapshot, checklistResponses: caseDoc.checklistResponses }
}

export async function addFinding(req: Request, id: string, finding: Record<string, unknown>) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)
  caseDoc.findings.push(finding as unknown as typeof caseDoc.findings[number])
  await caseDoc.save()
  const added = caseDoc.findings[caseDoc.findings.length - 1]
  return { id: added._id?.toString(), ...added.toObject?.() ?? added }
}

export async function patchFinding(req: Request, id: string, findingId: string, patch: Record<string, unknown>) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)
  const finding = caseDoc.findings.id(findingId)
  if (!finding) throw new NotFoundError('Finding not found')
  Object.assign(finding, patch)
  await caseDoc.save()
  return finding
}

export async function submitInspection(req: Request, id: string, report: Record<string, unknown>) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  assertCanEditInspection(req, caseDoc)

  const requiredFails = (caseDoc.checklistSnapshot ?? []).filter((item) => {
    const meta = item as { required?: boolean }
    if (!meta.required) return false
    const resp = (caseDoc.checklistResponses ?? []).find(
      (r) => r.snapshotItemId?.toString() === item._id?.toString(),
    )
    return !resp || resp.result === 'NOT_TESTED'
  })
  if (requiredFails.length) {
    throw new ValidationError('Complete all required checklist items before submission')
  }

  const criticalOpen = (caseDoc.findings ?? []).some(
    (f) => f.severity === 'CRITICAL' && f.diagnosisConfidence !== 'CONFIRMED',
  )
  if (criticalOpen && report.vehicleSafeToOperate === 'YES') {
    throw new ValidationError('Cannot mark vehicle safe to operate with unconfirmed critical findings')
  }

  caseDoc.inspectorReport = {
    ...(caseDoc.inspectorReport ?? {}),
    ...report,
    completedAt: new Date(),
  } as typeof caseDoc.inspectorReport
  caseDoc.status = 'AWAITING_REVIEW'
  caseDoc.submittedAt = new Date()
  caseDoc.reportVersion = (caseDoc.reportVersion ?? 0) + 1
  await caseDoc.save()

  await createAuditLog({
    tenantId: req.tenantId!,
    userId: req.user?.id,
    module: 'inspections',
    action: 'SUBMIT',
    recordId: id,
    req,
  })

  return mapInspectionCase(caseDoc)
}

export async function reviewInspection(
  req: Request,
  id: string,
  body: { decision: 'APPROVED' | 'REWORK'; comments?: string; reworkInstructions?: string },
) {
  const caseDoc = await InspectionCase.findOne({ _id: id, tenantId: req.tenantId! })
  if (!caseDoc) throw new NotFoundError('Inspection case not found')
  if (caseDoc.status !== 'AWAITING_REVIEW') throw new ConflictError('Inspection is not awaiting review')

  const isSupervisor = req.user?.permissions?.includes('service_visits.edit')
    || req.user?.permissions?.includes('admin.edit')
  if (!isSupervisor) throw new ForbiddenError('Supervisor permission required for review')

  caseDoc.reviews.push({
    reportVersion: caseDoc.reportVersion,
    reviewerId: req.user!.id as unknown as Types.ObjectId,
    decision: body.decision,
    comments: body.comments,
    reworkInstructions: body.reworkInstructions,
    reviewedAt: new Date(),
  })

  if (body.decision === 'REWORK') {
    caseDoc.status = 'REWORK_REQUIRED'
  } else {
    caseDoc.status = 'COMPLETED'
    caseDoc.approvedAt = new Date()
    caseDoc.reviewerId = req.user!.id as unknown as typeof caseDoc.reviewerId
    await advanceVisitToEstimateAfterInspection(req, caseDoc.serviceVisitId.toString())
    const { onInspectionApproved } = await import('../workflow/workflow-engine.service.js')
    await onInspectionApproved(req, caseDoc.serviceVisitId.toString())
    try {
      const { createFromInspectionCase } = await import('../estimates/estimates.service.js')
      await createFromInspectionCase(req, caseDoc._id.toString())
    } catch {
      // estimate may await tax config
    }
  }

  await caseDoc.save()

  await createAuditLog({
    tenantId: req.tenantId!,
    userId: req.user?.id,
    module: 'inspections',
    action: body.decision === 'APPROVED' ? 'APPROVE' : 'REWORK',
    recordId: id,
    newValue: { decision: body.decision },
    req,
  })

  return mapInspectionCase(caseDoc)
}

export async function advanceVisitToEstimateAfterInspection(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! })
  if (!visit) throw new NotFoundError('Service visit not found')

  const now = new Date()
  const inspectionIndex = SERVICE_STAGES.indexOf('INSPECTION')
  const diagnosisIndex = SERVICE_STAGES.indexOf('DIAGNOSIS')
  const estimateIndex = SERVICE_STAGES.indexOf('ESTIMATE')

  for (const log of visit.stageLogs ?? []) {
    const idx = SERVICE_STAGES.indexOf(log.stage as ServiceStage)
    if (idx < inspectionIndex && log.status !== 'COMPLETED') {
      log.status = 'COMPLETED'
      log.completedAt = now
    } else if (log.stage === 'INSPECTION') {
      log.status = 'COMPLETED'
      log.completedAt = now
      log.completedBy = req.user?.id as unknown as typeof log.completedBy
    } else if (log.stage === 'DIAGNOSIS') {
      log.status = 'SKIPPED'
      log.completedAt = now
      log.remarks = 'Handled within Trial & Inspection'
    } else if (log.stage === 'ESTIMATE') {
      log.status = 'CURRENT'
      log.startedAt = now
    } else if (idx > estimateIndex && log.status === 'CURRENT') {
      log.status = 'NOT_STARTED'
    }
  }

  visit.currentStage = 'ESTIMATE'
  visit.updatedBy = req.user?.id as unknown as typeof visit.updatedBy
  await visit.save()
}

export async function getInspectionReport(req: Request, id: string) {
  const detail = await getInspectionDetail(req, id)
  return {
    inspectionNumber: detail.inspectionNumber,
    status: detail.status,
    inspectorReport: detail.inspectorReport,
    findings: detail.findings,
    vocVerifications: detail.vocVerifications,
    trial: detail.trial,
    reviews: detail.reviews,
    approvedAt: detail.approvedAt,
  }
}

export async function listInspectionMasters(req: Request) {
  const tenantId = req.tenantId!
  const [categories, items, templates] = await Promise.all([
    MasterData.find({ tenantId, category: 'INSPECTION_CATEGORY', isActive: true }).sort({ sortOrder: 1 }).lean(),
    MasterData.find({ tenantId, category: 'INSPECTION_ITEM', isActive: true }).sort({ sortOrder: 1 }).lean(),
    MasterData.find({ tenantId, category: 'INSPECTION_TEMPLATE', isActive: true }).sort({ sortOrder: 1 }).lean(),
  ])
  return { categories, items, templates }
}
