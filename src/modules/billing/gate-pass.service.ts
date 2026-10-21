import type { Request } from 'express'
import { randomBytes } from 'node:crypto'
import { FinalInvoice, GatePass, QualityControlCase, ServiceVisit, Vehicle } from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { onGatePassIssued } from '../workflow/workflow-engine.service.js'

export async function assertGatePassEligible(invoiceId: string, tenantId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId, status: 'ISSUED' })
  if (!inv) return { ok: false, reason: 'Issued invoice required' }
  const qc = await QualityControlCase.findOne({ tenantId, serviceVisitId: inv.serviceVisitId })
  if (!qc || !['QC_PASSED', 'RELEASED_FOR_INVOICE'].includes(qc.status)) {
    return { ok: false, reason: 'QC pass required' }
  }
  const cleared = inv.balanceDue <= 0 || inv.paymentStatus === 'PAID' || inv.creditClearanceAuthorized
  if (!cleared) return { ok: false, reason: 'Payment or credit clearance required' }
  return { ok: true, invoice: inv, qc }
}

export async function createGatePassFromInvoice(req: Request, invoiceId: string, idempotencyKey?: string) {
  if (idempotencyKey) {
    const dup = await GatePass.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return { gatePass: dup, duplicate: true }
  }
  const check = await assertGatePassEligible(invoiceId, req.tenantId!)
  if (!check.ok) throw new ValidationError(check.reason!)
  const inv = check.invoice!

  const active = await GatePass.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: inv.serviceVisitId,
    status: { $in: ['ISSUED', 'READY_FOR_ISSUE'] },
  })
  if (active) return { gatePass: active, duplicate: true }

  const vehicle = await Vehicle.findById(inv.vehicleId).lean()
  const gatePassNumber = await generateDocumentNumber(req.tenantId!, 'GATE_PASS')
  const token = randomBytes(16).toString('hex')

  const gp = await GatePass.create({
    tenantId: req.tenantId!,
    branchId: inv.branchId,
    serviceVisitId: inv.serviceVisitId,
    invoiceId: inv._id,
    gatePassNumber,
    vehicleRegistration: vehicle?.registrationNo,
    customerId: inv.customerId,
    qcReference: inv.qcReference,
    paymentClearanceRef: inv.creditClearanceAuthorized ? 'CREDIT' : 'PAID',
    status: 'READY_FOR_ISSUE',
    verificationToken: token,
    idempotencyKey,
  })
  return { gatePass: gp, duplicate: false }
}

export async function issueGatePass(req: Request, gatePassId: string) {
  const gp = await GatePass.findOne({ _id: gatePassId, tenantId: req.tenantId! })
  if (!gp) throw new NotFoundError('Gate pass not found')
  if (gp.status === 'ISSUED') return gp
  const check = await assertGatePassEligible(gp.invoiceId.toString(), req.tenantId!)
  if (!check.ok) throw new ValidationError(check.reason!)

  gp.status = 'ISSUED'
  gp.issueDate = new Date()
  gp.issuedBy = req.user?.id as unknown as typeof gp.issuedBy
  gp.validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await gp.save()

  const visit = await ServiceVisit.findById(gp.serviceVisitId)
  if (visit) {
    visit.currentStage = 'GATEPASS'
    await visit.save()
  }
  await createAuditLog({ req, module: 'gate_pass', action: 'ISSUED', recordId: gatePassId })
  if (visit) await onGatePassIssued(req, visit._id.toString())
  return gp
}

export async function voidGatePass(req: Request, gatePassId: string, reason: string) {
  const gp = await GatePass.findOne({ _id: gatePassId, tenantId: req.tenantId! })
  if (!gp) throw new NotFoundError('Gate pass not found')
  if (gp.status === 'USED') throw new ValidationError('Cannot void a used gate pass')
  gp.status = 'VOID'
  gp.remarks = reason
  await gp.save()
  await createAuditLog({ req, module: 'gate_pass', action: 'VOID', recordId: gatePassId, newValue: { reason } })
  return gp
}
