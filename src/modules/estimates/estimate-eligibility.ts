import { InspectionCase, ReceivingRecord, ServiceVisit, VocRecord } from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import type { Request } from 'express'

export async function loadEstimateEligibilityContext(req: Request, visitId: string) {
  const tenantId = req.tenantId!
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId })
    .populate('customerId')
    .populate('vehicleId')
    .populate('bookingId')
    .lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const [receiving, voc, inspection] = await Promise.all([
    ReceivingRecord.findOne({ tenantId, visitId }).lean(),
    VocRecord.findOne({ tenantId, visitId }).lean(),
    InspectionCase.findOne({ tenantId, serviceVisitId: visitId }).lean(),
  ])

  return { visit, receiving, voc, inspection }
}

export function assertEligibleForEstimate(
  receiving: { receivingStatus?: string } | null,
  voc: { confirmationStatus?: string; complaints?: unknown[] } | null,
  inspection: { status?: string } | null,
) {
  if (!receiving || receiving.receivingStatus !== 'COMPLETED') {
    throw new ValidationError('Gate-in and receiving must be completed before estimation')
  }
  const vocOk = voc?.confirmationStatus === 'CONFIRMED'
    || (voc?.complaints ?? []).some((c) => (c as { isPreventiveMaintenance?: boolean }).isPreventiveMaintenance)
  if (!vocOk) {
    throw new ValidationError('VOC must be confirmed before estimation')
  }
  if (!inspection || inspection.status !== 'COMPLETED') {
    throw new ValidationError('Inspection must be reviewed and approved before estimation')
  }
}

export async function assertVisitEligibleForEstimate(req: Request, visitId: string) {
  const ctx = await loadEstimateEligibilityContext(req, visitId)
  assertEligibleForEstimate(ctx.receiving, ctx.voc, ctx.inspection)
  return ctx
}
