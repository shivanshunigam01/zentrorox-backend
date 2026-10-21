import type { Request } from 'express'
import { GatePass, ServiceVisit, VehicleDelivery } from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { onDeliveryCompleted } from '../workflow/workflow-engine.service.js'

export async function createDeliveryFromGatePass(req: Request, gatePassId: string) {
  const gp = await GatePass.findOne({ _id: gatePassId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!gp) throw new ValidationError('Valid issued gate pass required')

  const existing = await VehicleDelivery.findOne({ tenantId: req.tenantId!, serviceVisitId: gp.serviceVisitId })
  if (existing) return existing

  return VehicleDelivery.create({
    tenantId: req.tenantId!,
    branchId: gp.branchId,
    serviceVisitId: gp.serviceVisitId,
    gatePassId: gp._id,
    invoiceId: gp.invoiceId,
    vehicleRegistration: gp.vehicleRegistration,
    status: 'PENDING',
  })
}

export async function completeDelivery(req: Request, deliveryId: string, body: Record<string, unknown>) {
  const delivery = await VehicleDelivery.findOne({ _id: deliveryId, tenantId: req.tenantId! })
  if (!delivery) throw new NotFoundError('Delivery not found')
  if (delivery.status === 'COMPLETED') return { delivery, duplicate: true }

  const gp = await GatePass.findById(delivery.gatePassId)
  if (!gp || gp.status !== 'ISSUED') throw new ValidationError('Gate pass must be issued and unused')

  const odo = body.finalOdometer != null ? Number(body.finalOdometer) : undefined
  if (odo != null && odo < 0) throw new ValidationError('Invalid odometer')

  delivery.receiverName = body.receiverName as string
  delivery.receiverMobile = body.receiverMobile as string
  delivery.receiverVerificationMethod = body.receiverVerificationMethod as string
  delivery.finalOdometer = odo
  delivery.finalFuelLevel = body.finalFuelLevel as string
  delivery.keysReturned = body.keysReturned !== false
  delivery.deliveryChecklist = body.deliveryChecklist
  delivery.customerAcknowledged = body.customerAcknowledged === true
  delivery.deliveryRemarks = body.deliveryRemarks as string
  delivery.status = 'COMPLETED'
  delivery.deliveredAt = new Date()
  delivery.deliveredBy = req.user?.id as unknown as typeof delivery.deliveredBy
  await delivery.save()

  gp.status = 'USED'
  await gp.save()

  const visit = await ServiceVisit.findById(delivery.serviceVisitId)
  if (visit) {
    visit.currentStage = 'DELIVERY'
    visit.deliveredAt = delivery.deliveredAt
    visit.status = 'COMPLETED'
    visit.serviceClosedAt = new Date()
    if (odo != null) visit.finalQcOdometer = odo
    await visit.save()
  }

  await createAuditLog({ req, module: 'delivery', action: 'COMPLETED', recordId: deliveryId })
  if (visit) await onDeliveryCompleted(req, visit._id.toString())
  return { delivery, duplicate: false }
}
