import { Booking, ServiceVisit, JobCard, Bay, Vehicle } from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { SERVICE_STAGES, STAGE_UI_PATHS } from '../../types/enums.js'
import type { Request } from 'express'
import type { ServiceStage } from '../../types/enums.js'

const ALL_SERVICE_STAGES = SERVICE_STAGES

interface ListParams {
  search?: string
  stage?: ServiceStage
  status?: string
  outstandingOnly?: boolean
  page?: number
  limit?: number
}

function formatStageLabel(stage: ServiceStage): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatServiceVisit(visit: {
  _id: { toString(): string }
  visitNumber: string
  jobCardNumber?: string
  advisorId?: unknown
  status: string
  currentStage: ServiceStage
  promiseTime?: Date
  outstanding?: number
  odometer?: number
  fuelLevel?: string
  stageLogs?: { stage: ServiceStage; status: string }[]
  customerId?: { name: string; mobile: string; _id?: { toString(): string } }
  vehicleId?: {
    registrationNo: string
    make: string
    model: string
    variant?: string
    vin?: string
    chassisNo?: string
    engineNo?: string
    imageUrl?: string
    imagePublicId?: string
    _id?: { toString(): string }
  }
}) {
  const stageMap = new Map((visit.stageLogs ?? []).map((l) => [l.stage, l.status]))

  const stages = ALL_SERVICE_STAGES.map((stage) => ({
    id: stage.toLowerCase(),
    label: formatStageLabel(stage),
    status: (stageMap.get(stage) ?? 'NOT_STARTED').toLowerCase(),
    path: STAGE_UI_PATHS[stage],
  }))

  const customer = visit.customerId as { name: string; mobile: string } | undefined
  const vehicle = visit.vehicleId as {
    registrationNo: string
    make: string
    model: string
    variant?: string
    vin?: string
    chassisNo?: string
    engineNo?: string
    imageUrl?: string
    imagePublicId?: string
    _id?: { toString(): string }
  } | undefined

  return {
    id: visit._id.toString(),
    visitNumber: visit.visitNumber,
    registrationNumber: vehicle?.registrationNo ?? '—',
    customerName: customer?.name ?? '—',
    customerMobile: customer?.mobile ?? '—',
    make: vehicle?.make,
    model: vehicle?.model,
    variant: vehicle?.variant,
    vin: vehicle?.vin,
    chassisNo: vehicle?.chassisNo ?? vehicle?.vin,
    engineNo: vehicle?.engineNo,
    vehicleImageUrl: vehicle?.imageUrl,
    vehicleImagePublicId: vehicle?.imagePublicId,
    vehicleId: vehicle?._id?.toString(),
    jobCardNumber: visit.jobCardNumber,
    advisor: visit.advisorId,
    status: visit.status,
    currentStage: visit.currentStage,
    promiseTime: visit.promiseTime,
    outstanding: visit.outstanding ?? 0,
    odometer: visit.odometer,
    fuel: visit.fuelLevel,
    stages,
  }
}

export async function listServiceVisits(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = {
    tenantId,
    ...(branchId && { branchId }),
    ...(params.stage && { currentStage: params.stage }),
    ...(params.status && { status: params.status }),
    ...(params.outstandingOnly && { outstanding: { $gt: 0 } }),
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [{ visitNumber: regex }, { jobCardNumber: regex }]
  }

  const [items, total] = await Promise.all([
    ServiceVisit.find(filter)
      .populate('customerId', 'id name mobile')
      .populate('vehicleId', 'id registrationNo make model variant')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ServiceVisit.countDocuments(filter),
  ])

  return {
    items: items.map((sv) => formatServiceVisit(sv as unknown as Parameters<typeof formatServiceVisit>[0])),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getServiceVisit(req: Request, id: string) {
  const visit = await ServiceVisit.findOne({ _id: id, tenantId: req.tenantId! })
    .populate('customerId')
    .populate('vehicleId')
    .populate('branchId')
    .lean()

  if (!visit) throw new NotFoundError('Service visit not found')
  return formatServiceVisit(visit as unknown as Parameters<typeof formatServiceVisit>[0])
}

export async function createFromBooking(req: Request, bookingId: string) {
  const tenantId = req.tenantId!
  const booking = await Booking.findOne({ _id: bookingId, tenantId }).lean()
  if (!booking) throw new NotFoundError('Booking not found')
  if (booking.serviceVisitId) throw new ValidationError('Service visit already exists for this booking')

  const visitNumber = await generateDocumentNumber(tenantId, 'SERVICE_VISIT')

  const stageLogs = ALL_SERVICE_STAGES.map((stage) => ({
    stage,
    status: stage === 'BOOKING' ? 'COMPLETED' : stage === 'ARRIVAL' ? 'CURRENT' : 'NOT_STARTED',
    ...(stage === 'BOOKING' && { completedAt: new Date() }),
    ...(stage === 'ARRIVAL' && { startedAt: new Date() }),
  }))

  const visit = await ServiceVisit.create({
    tenantId,
    branchId: booking.branchId,
    visitNumber,
    customerId: booking.customerId,
    vehicleId: booking.vehicleId,
    bookingId: booking._id,
    currentStage: 'ARRIVAL',
    status: 'OPEN',
    advisorId: booking.advisorId,
    stageLogs,
    createdBy: req.user?.id,
  })

  await Booking.updateOne(
    { _id: booking._id },
    { serviceVisitId: visit._id, status: 'ARRIVED' },
  )

  return getServiceVisit(req, visit._id.toString())
}

export async function advanceStage(req: Request, id: string, targetStage: ServiceStage) {
  const visit = await ServiceVisit.findOne({ _id: id, tenantId: req.tenantId! })
  if (!visit) throw new NotFoundError('Service visit not found')

  const stageIndex = ALL_SERVICE_STAGES.indexOf(targetStage)
  if (stageIndex === -1) throw new ValidationError('Invalid stage')

  const now = new Date()
  const logs = visit.stageLogs ?? []

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i]
    const logStageIndex = ALL_SERVICE_STAGES.indexOf(log.stage as ServiceStage)
    if (logStageIndex < stageIndex) {
      log.status = 'COMPLETED'
      log.completedAt = now
      log.completedBy = req.user?.id as unknown as typeof log.completedBy
    } else if (log.stage === targetStage) {
      log.status = 'CURRENT'
      log.startedAt = now
    }
  }

  visit.stageLogs = logs
  visit.currentStage = targetStage
  if (targetStage === 'DELIVERY') visit.status = 'IN_PROGRESS'
  visit.updatedBy = req.user?.id as unknown as typeof visit.updatedBy
  await visit.save()

  return getServiceVisit(req, id)
}

export async function getWipBoard(req: Request) {
  const tenantId = req.tenantId!
  const branchId = req.branchId

  const visits = await ServiceVisit.find({
    tenantId,
    ...(branchId && { branchId }),
    status: { $in: ['OPEN', 'IN_PROGRESS'] },
  })
    .populate('vehicleId', 'registrationNo make model variant')
    .populate('customerId', 'name')
    .sort({ createdAt: 1 })
    .lean()

  const visitIds = visits.map((v) => v._id)
  const jobCards = await JobCard.find({ serviceVisitId: { $in: visitIds } })
    .populate('bayId', 'name')
    .lean()

  const jcByVisit = new Map(jobCards.map((jc) => [jc.serviceVisitId.toString(), jc]))

  return visits.map((sv) => {
    const ageingMs = Date.now() - new Date(sv.createdAt).getTime()
    const ageingHours = Math.floor(ageingMs / (1000 * 60 * 60))
    const ageingMinutes = Math.floor((ageingMs % (1000 * 60 * 60)) / (1000 * 60))
    const vehicle = sv.vehicleId as unknown as { registrationNo: string; make: string; model: string; variant?: string } | null
    const jc = jcByVisit.get(sv._id.toString())
    const bay = jc?.bayId as { name: string } | null

    return {
      id: sv._id.toString(),
      visitNumber: sv.visitNumber,
      registration: vehicle?.registrationNo ?? '—',
      model: vehicle ? `${vehicle.make} ${vehicle.model} ${vehicle.variant ?? ''}`.trim() : '—',
      jc: jc?.jobCardNumber ?? sv.jobCardNumber,
      advisor: sv.advisorId,
      technician: null,
      bay: bay?.name ?? '—',
      status: sv.currentStage,
      promiseTime: sv.promiseTime,
      pendingSince: `${ageingHours}h ${ageingMinutes}m`,
      ageing: `${ageingHours}h ${ageingMinutes}m`,
      reason: sv.currentStage.replace(/_/g, ' '),
    }
  })
}

export async function updateServiceVisit(
  req: Request,
  id: string,
  body: {
    odometer?: number
    fuelLevel?: string
    promiseTime?: string
    remarks?: string
    outstanding?: number
    engineNo?: string
    chassisNo?: string
    vehicleImageUrl?: string
    vehicleImagePublicId?: string
  },
) {
  const visit = await ServiceVisit.findOne({ _id: id, tenantId: req.tenantId! })
  if (!visit) throw new NotFoundError('Service visit not found')

  if (body.odometer !== undefined) visit.odometer = body.odometer
  if (body.fuelLevel !== undefined) visit.fuelLevel = body.fuelLevel
  if (body.promiseTime !== undefined) visit.promiseTime = new Date(body.promiseTime)
  if (body.remarks !== undefined) visit.remarks = body.remarks
  if (body.outstanding !== undefined) visit.outstanding = body.outstanding
  visit.updatedBy = req.user?.id as unknown as typeof visit.updatedBy
  await visit.save()

  const needsVehicleUpdate =
    body.engineNo !== undefined ||
    body.chassisNo !== undefined ||
    body.vehicleImageUrl !== undefined ||
    body.vehicleImagePublicId !== undefined ||
    body.odometer !== undefined

  if (needsVehicleUpdate && visit.vehicleId) {
    const vehicle = await Vehicle.findOne({ _id: visit.vehicleId, tenantId: req.tenantId! })
    if (vehicle) {
      if (body.engineNo !== undefined) vehicle.engineNo = body.engineNo
      if (body.chassisNo !== undefined) {
        vehicle.chassisNo = body.chassisNo
        if (!vehicle.vin) vehicle.vin = body.chassisNo
      }
      if (body.vehicleImageUrl !== undefined) vehicle.imageUrl = body.vehicleImageUrl
      if (body.vehicleImagePublicId !== undefined) vehicle.imagePublicId = body.vehicleImagePublicId
      if (body.odometer !== undefined) vehicle.odometer = body.odometer
      vehicle.updatedBy = req.user?.id as unknown as typeof vehicle.updatedBy
      await vehicle.save()
    }
  }

  return getServiceVisit(req, id)
}

export async function addInspectionImage(
  req: Request,
  id: string,
  image: { url: string; publicId: string; caption?: string },
) {
  const visit = await ServiceVisit.findOne({ _id: id, tenantId: req.tenantId! })
  if (!visit) throw new NotFoundError('Service visit not found')

  visit.inspectionImages = visit.inspectionImages ?? []
  visit.inspectionImages.push({
    url: image.url,
    publicId: image.publicId,
    caption: image.caption,
    uploadedAt: new Date(),
  })
  await visit.save()

  return visit.inspectionImages
}
