import type { ServiceStage } from '../../types/enums.js'

export type WorkflowTransitionRule = {
  event: string
  sourceModule: string
  minStage?: ServiceStage
  targetStage: ServiceStage
  description: string
}

/** Authoritative transition catalog — queues are driven by persisted visit/entity state. */
export const WORKFLOW_TRANSITIONS: WorkflowTransitionRule[] = [
  { event: 'BOOKING_CONFIRMED', sourceModule: 'booking', targetStage: 'PICKUP', description: 'Pickup queue when pickup required' },
  { event: 'GATE_IN_COMPLETED', sourceModule: 'receiving', targetStage: 'INSPECTION', description: 'Inspection queue after receiving' },
  { event: 'INSPECTION_APPROVED', sourceModule: 'inspection', targetStage: 'ESTIMATE', description: 'Estimate queue' },
  { event: 'ESTIMATE_ISSUED', sourceModule: 'estimate', targetStage: 'APPROVAL', description: 'Customer approval queue' },
  { event: 'CUSTOMER_APPROVED', sourceModule: 'approval', targetStage: 'JOB_CARD', description: 'Job card eligibility' },
  { event: 'JOB_CARD_RELEASED', sourceModule: 'job_card', targetStage: 'WIP', description: 'WIP queue' },
  { event: 'WIP_COMPLETED', sourceModule: 'wip', targetStage: 'QC', description: 'Final QC queue' },
  { event: 'QC_PASSED', sourceModule: 'qc', targetStage: 'INVOICE', description: 'Invoice queue (invoiceReady flag)' },
  { event: 'INVOICE_ISSUED', sourceModule: 'billing', minStage: 'INVOICE', targetStage: 'PAYMENT', description: 'Payment collection queue' },
  { event: 'INVOICE_FULLY_PAID', sourceModule: 'billing', targetStage: 'PAYMENT', description: 'Gate pass eligibility' },
  { event: 'GATE_PASS_ISSUED', sourceModule: 'gate_pass', targetStage: 'GATEPASS', description: 'Delivery pending' },
  { event: 'DELIVERY_COMPLETED', sourceModule: 'delivery', targetStage: 'FEEDBACK', description: 'Feedback / closure' },
]
