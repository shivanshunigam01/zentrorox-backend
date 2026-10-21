import type { Request } from 'express'
import { ServiceVisit } from '../../models/index.js'
import { createAuditLog } from '../../utils/audit.js'
import type { ServiceStage } from '../../types/enums.js'
import { WORKFLOW_TRANSITIONS } from './workflow-transitions.js'

export async function applyWorkflowTransition(
  req: Request | null,
  visitId: string,
  tenantId: string,
  event: string,
  targetStage: ServiceStage,
  meta?: Record<string, unknown>,
) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId })
  if (!visit) return null

  const rule = WORKFLOW_TRANSITIONS.find((t) => t.event === event)
  if (rule?.minStage) {
    const order = ['BOOKING', 'PICKUP', 'ARRIVAL', 'INVENTORY', 'VOC', 'INSPECTION', 'ESTIMATE', 'APPROVAL', 'JOB_CARD', 'WIP', 'QC', 'INVOICE', 'PAYMENT', 'GATEPASS', 'DELIVERY', 'FEEDBACK']
    const cur = order.indexOf(visit.currentStage)
    const min = order.indexOf(rule.minStage)
    if (cur >= 0 && min >= 0 && cur < min) {
      visit.currentStage = rule.minStage
    }
  }

  if (targetStage) visit.currentStage = targetStage

  if (event === 'INVOICE_ISSUED') {
    visit.outstanding = visit.outstanding ?? 0
  }
  if (event === 'INVOICE_FULLY_PAID') {
    visit.outstanding = 0
  }

  await visit.save()

  if (req) {
    await createAuditLog({
      req,
      module: 'workflow',
      action: event,
      recordId: visitId,
      newValue: { targetStage, ...meta },
    })
  }

  return visit
}

export async function onInvoiceIssued(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'INVOICE_ISSUED', 'PAYMENT', {
    queue: 'payment_collection',
  })
}

export async function onInvoiceSettlementChanged(
  req: Request | null,
  tenantId: string,
  visitId: string,
  balanceDue: number,
  paymentStatus: string,
) {
  if (balanceDue <= 0 && paymentStatus === 'PAID') {
    return applyWorkflowTransition(req, visitId, tenantId, 'INVOICE_FULLY_PAID', 'PAYMENT', {
      gatePassEligible: true,
    })
  }
  return applyWorkflowTransition(req, visitId, tenantId, 'INVOICE_PARTIALLY_PAID', 'PAYMENT', {
    balanceDue,
  })
}

export async function onGatePassIssued(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'GATE_PASS_ISSUED', 'GATEPASS')
}

export async function onDeliveryCompleted(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'DELIVERY_COMPLETED', 'FEEDBACK')
}

export async function onInspectionApproved(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'INSPECTION_APPROVED', 'ESTIMATE')
}

export async function onEstimateIssued(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'ESTIMATE_ISSUED', 'APPROVAL')
}

export async function onJobCardCreated(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'JOB_CARD_CREATED', 'JOB_CARD')
}

export async function onWipReleasedToQc(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'WIP_COMPLETED', 'QC')
}

export async function onQcPassed(req: Request, visitId: string) {
  return applyWorkflowTransition(req, visitId, req.tenantId!, 'QC_PASSED', 'INVOICE')
}
