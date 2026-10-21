import { ReceivingRecord, ServiceVisit, VocRecord } from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import type { Request } from 'express'

export async function loadVisitEligibilityContext(req: Request, visitId: string) {
  const tenantId = req.tenantId!
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId })
    .populate('bookingId')
    .populate('vehicleId')
    .populate('customerId')
    .lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  const receiving = await ReceivingRecord.findOne({ tenantId, visitId }).lean()
  const voc = await VocRecord.findOne({ tenantId, visitId }).lean()

  return { visit, receiving, voc }
}

export function assertEligibleForInspection(
  receiving: { receivingStatus?: string; exceptionFlags?: string[] } | null,
  voc: {
    confirmationStatus?: string
    complaints?: Array<{ isPreventiveMaintenance?: boolean }>
  } | null,
) {
  if (!receiving) {
    throw new ValidationError('Vehicle receiving must be started before inspection')
  }
  if (!['COMPLETED', 'EXCEPTION'].includes(receiving.receivingStatus ?? '')) {
    throw new ValidationError('Vehicle receiving must be completed before inspection')
  }
  const blockingException =
    receiving.receivingStatus === 'EXCEPTION'
    && (receiving.exceptionFlags ?? []).includes('IDENTITY_MISMATCH')
  if (blockingException) {
    throw new ValidationError('Unresolved receiving identity exception blocks inspection')
  }

  const vocConfirmed = voc?.confirmationStatus === 'CONFIRMED'
  const preventiveOnly = (voc?.complaints ?? []).some((c) => c.isPreventiveMaintenance)
  const hasComplaints = (voc?.complaints ?? []).length > 0

  if (!vocConfirmed && !preventiveOnly) {
    throw new ValidationError('VOC must be confirmed or preventive-maintenance declared before inspection')
  }
  if (!voc && !hasComplaints) {
    throw new ValidationError('VOC record required before inspection')
  }
}

export async function assertVisitEligible(req: Request, visitId: string) {
  const ctx = await loadVisitEligibilityContext(req, visitId)
  assertEligibleForInspection(ctx.receiving, ctx.voc)
  return ctx
}
