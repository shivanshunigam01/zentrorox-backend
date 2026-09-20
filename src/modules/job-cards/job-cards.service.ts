import { JobCard, ServiceVisit } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import type { Request } from 'express'

interface ListParams {
  search?: string
  status?: string
  page?: number
  limit?: number
}

function formatJobCard(jc: {
  _id: { toString(): string }
  jobCardNumber: string
  jobType?: string
  status: string
  approvedValue?: number
  currentValue?: number
  promiseDate?: Date
  holdReason?: string
  serviceVisitId?: {
    _id?: { toString(): string }
    visitNumber?: string
    currentStage?: string
    vehicleId?: { registrationNo?: string; make?: string; model?: string }
    customerId?: { name?: string }
  }
  bayId?: { name?: string; code?: string }
  advisorId?: { firstName?: string; lastName?: string }
}) {
  const visit = jc.serviceVisitId as {
    _id?: { toString(): string }
    visitNumber?: string
    currentStage?: string
    vehicleId?: { registrationNo?: string; make?: string; model?: string }
    customerId?: { name?: string }
  } | undefined
  const vehicle = visit?.vehicleId
  const bay = jc.bayId as { name?: string; code?: string } | undefined
  const advisor = jc.advisorId as { firstName?: string; lastName?: string } | undefined

  return {
    id: jc._id.toString(),
    jobCardNumber: jc.jobCardNumber,
    jobType: jc.jobType,
    status: jc.status,
    approvedValue: jc.approvedValue ?? 0,
    currentValue: jc.currentValue ?? 0,
    promiseDate: jc.promiseDate,
    holdReason: jc.holdReason,
    visitId: visit?._id?.toString(),
    visitNumber: visit?.visitNumber,
    currentStage: visit?.currentStage,
    registration: vehicle?.registrationNo ?? '—',
    vehicle: vehicle ? `${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim() : '—',
    customer: visit?.customerId?.name ?? '—',
    bay: bay?.name ?? '—',
    advisor: advisor ? `${advisor.firstName} ${advisor.lastName ?? ''}`.trim() : '—',
  }
}

export async function listJobCards(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = {
    tenantId,
    ...(branchId && { branchId }),
    ...(params.status && { status: params.status }),
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [{ jobCardNumber: regex }, { jobType: regex }]
  }

  const [items, total] = await Promise.all([
    JobCard.find(filter)
      .populate({
        path: 'serviceVisitId',
        populate: [
          { path: 'vehicleId', select: 'registrationNo make model' },
          { path: 'customerId', select: 'name' },
        ],
      })
      .populate('bayId', 'name code')
      .populate('advisorId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobCard.countDocuments(filter),
  ])

  return {
    items: items.map((jc) => formatJobCard(jc as unknown as Parameters<typeof formatJobCard>[0])),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getJobCard(req: Request, id: string) {
  const jc = await JobCard.findOne({ _id: id, tenantId: req.tenantId! })
    .populate({
      path: 'serviceVisitId',
      populate: [
        { path: 'vehicleId', select: 'registrationNo make model variant' },
        { path: 'customerId', select: 'name mobile' },
      ],
    })
    .populate('bayId', 'name code bayType')
    .populate('advisorId', 'firstName lastName email')
    .lean()

  if (!jc) throw new NotFoundError('Job card not found')
  return formatJobCard(jc as unknown as Parameters<typeof formatJobCard>[0])
}

export async function getJobCardByVisit(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! }).lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const jc = await JobCard.findOne({ serviceVisitId: visitId, tenantId: req.tenantId! })
    .populate({
      path: 'serviceVisitId',
      populate: [
        { path: 'vehicleId', select: 'registrationNo make model variant' },
        { path: 'customerId', select: 'name mobile' },
      ],
    })
    .populate('bayId', 'name code bayType')
    .populate('advisorId', 'firstName lastName email')
    .lean()

  if (!jc) return null
  return formatJobCard(jc as unknown as Parameters<typeof formatJobCard>[0])
}
