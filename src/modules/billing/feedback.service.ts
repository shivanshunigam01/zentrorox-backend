import type { Request } from 'express'
import { CustomerFeedback, ServiceVisit, VehicleDelivery } from '../../models/index.js'
import { ValidationError } from '../../utils/errors.js'

export async function submitFeedback(req: Request, body: Record<string, unknown>) {
  const serviceVisitId = String(body.serviceVisitId)
  const existing = await CustomerFeedback.findOne({ tenantId: req.tenantId!, serviceVisitId })
  if (existing) return existing

  const delivery = await VehicleDelivery.findOne({ tenantId: req.tenantId!, serviceVisitId, status: 'COMPLETED' })
  if (!delivery) throw new ValidationError('Vehicle must be delivered before feedback')

  const rating = Number(body.overallRating)
  if (!rating || rating < 1 || rating > 5) throw new ValidationError('Rating 1-5 required')

  const visit = await ServiceVisit.findById(serviceVisitId).lean()
  return CustomerFeedback.create({
    tenantId: req.tenantId!,
    customerId: visit?.customerId ?? body.customerId,
    vehicleId: body.vehicleId,
    serviceVisitId,
    invoiceId: delivery.invoiceId,
    deliveryId: delivery._id,
    overallRating: rating,
    serviceQuality: body.serviceQuality,
    repairSatisfaction: body.repairSatisfaction,
    timeliness: body.timeliness,
    staffBehaviour: body.staffBehaviour,
    billingTransparency: body.billingTransparency,
    wouldRecommend: body.wouldRecommend,
    customerRemarks: body.customerRemarks,
    additionalComplaint: body.additionalComplaint,
    feedbackSource: body.feedbackSource ?? 'IN_PERSON',
    followUpRequired: rating <= 2 || Boolean(body.additionalComplaint),
  })
}

export async function listFeedbackByVisit(req: Request, visitId: string) {
  return CustomerFeedback.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean()
}
