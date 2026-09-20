import { Bay, JobCard } from '../../models/index.js'
import type { Request } from 'express'

export async function listBays(req: Request) {
  const tenantId = req.tenantId!
  const branchId = req.branchId

  const bays = await Bay.find({
    tenantId,
    isActive: true,
    ...(branchId && { branchId }),
  })
    .sort({ code: 1 })
    .lean()

  const activeJobCards = await JobCard.find({
    tenantId,
    ...(branchId && { branchId }),
    status: { $in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
    bayId: { $ne: null },
  })
    .populate('serviceVisitId', 'visitNumber currentStage')
    .populate({
      path: 'serviceVisitId',
      populate: { path: 'vehicleId', select: 'registrationNo make model' },
    })
    .lean()

  const jcByBay = new Map(
    activeJobCards.map((jc) => [jc.bayId?.toString(), jc]),
  )

  return bays.map((bay) => {
    const jc = jcByBay.get(bay._id.toString())
    const visit = jc?.serviceVisitId as {
      _id?: { toString(): string }
      visitNumber?: string
      currentStage?: string
      vehicleId?: { registrationNo?: string; make?: string; model?: string }
    } | undefined
    const vehicle = visit?.vehicleId

    return {
      id: bay._id.toString(),
      code: bay.code,
      name: bay.name,
      bayType: bay.bayType,
      status: jc ? 'OCCUPIED' : 'AVAILABLE',
      jobCardNumber: jc?.jobCardNumber,
      visitId: visit?._id?.toString(),
      visitNumber: visit?.visitNumber,
      registration: vehicle?.registrationNo,
      vehicle: vehicle ? `${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim() : undefined,
      currentStage: visit?.currentStage,
    }
  })
}
