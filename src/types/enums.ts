export const CUSTOMER_TYPES = ['INDIVIDUAL', 'FLEET', 'CORPORATE', 'INSURANCE'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

/** Phase-1 booking lifecycle (legacy values kept for existing MongoDB rows). */
export const BOOKING_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'AWAITING_PICKUP',
  'PICKUP_ASSIGNED',
  'PICKUP_IN_PROGRESS',
  'AWAITING_GATE_IN',
  'CHECKED_IN',
  'CANCELLED',
  'NO_SHOW',
  'BOOKED',
  'RESCHEDULED',
  'ARRIVED',
] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const BOOKING_TYPES = ['NORMAL', 'BREAKDOWN_ON_SPOT'] as const
export type BookingType = (typeof BOOKING_TYPES)[number]

export const ARRIVAL_METHODS = ['SELF', 'PICKUP'] as const
export type ArrivalMethod = (typeof ARRIVAL_METHODS)[number]

export const PICKUP_TASK_STATUSES = [
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const
export type PickupTaskStatus = (typeof PICKUP_TASK_STATUSES)[number]

export const RECEIVING_STATUSES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'EXCEPTION'] as const
export type ReceivingStatus = (typeof RECEIVING_STATUSES)[number]

export const IMAGE_CATEGORIES = [
  'BOOKING',
  'BREAKDOWN',
  'PICKUP',
  'GATE_IN',
  'INVENTORY',
  'VOC',
  'DAMAGE',
  'ODOMETER',
  'ENGINE',
  'CHASSIS',
  'TRIAL',
  'INSPECTION',
  'FINDING',
  'DIAGNOSTIC',
  'QC_BEFORE',
  'QC_AFTER',
  'QC_DEFECT',
  'ROAD_TEST',
  'REWORK',
  'WIP_EVIDENCE',
] as const
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number]

export const CREDIT_NOTE_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_APPLIED',
  'FULLY_APPLIED',
  'CANCELLED',
  'REVERSED',
] as const
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number]

export const EINVOICE_IRN_STATUSES = [
  'NOT_APPLICABLE',
  'NOT_REQUIRED',
  'PENDING',
  'GENERATED',
  'FAILED',
  'CANCELLED',
] as const
export type EInvoiceIrnStatus = (typeof EINVOICE_IRN_STATUSES)[number]

export const VOC_SOURCES = ['BOOKING', 'BREAKDOWN', 'PICKUP', 'GATE_IN', 'ADVISOR'] as const
export type VocSource = (typeof VOC_SOURCES)[number]

export const VOC_CONFIRMATION_STATUSES = ['DRAFT', 'CONFIRMED'] as const
export type VocConfirmationStatus = (typeof VOC_CONFIRMATION_STATUSES)[number]

export function normalizeBookingStatus(status: string): BookingStatus {
  if (status === 'BOOKED') return 'CONFIRMED'
  if (status === 'ARRIVED') return 'CHECKED_IN'
  return status as BookingStatus
}

export const PICKUP_IMAGE_TYPES = [
  'FRONT', 'REAR', 'LEFT', 'RIGHT', 'STEPNEY', 'INTERIOR', 'OTHER_GOODS',
] as const
export type PickupImageType = (typeof PICKUP_IMAGE_TYPES)[number]

export const REQUIRED_PICKUP_IMAGE_TYPES: PickupImageType[] = [
  'FRONT', 'REAR', 'LEFT', 'RIGHT', 'INTERIOR',
]

export const SERVICE_VISIT_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const
export type ServiceVisitStatus = (typeof SERVICE_VISIT_STATUSES)[number]

export const SERVICE_STAGES = [
  'BOOKING', 'PICKUP', 'ARRIVAL', 'INVENTORY', 'VOC', 'INSPECTION',
  'DIAGNOSIS', 'ESTIMATE', 'APPROVAL', 'JOB_CARD', 'ASSIGNMENT', 'BAY',
  'WIP', 'QC', 'ROAD_TEST', 'INVOICE', 'PAYMENT', 'GATEPASS',
  'DELIVERY', 'FEEDBACK', 'PSF',
] as const
export type ServiceStage = (typeof SERVICE_STAGES)[number]

/** UI route segment for each workflow stage (matches frontend WORKFLOW_STAGES paths). */
export const STAGE_UI_PATHS: Record<ServiceStage, string> = {
  BOOKING: 'booking',
  PICKUP: 'pickup',
  ARRIVAL: 'gate-in',
  INVENTORY: 'receiving',
  VOC: 'inspection',
  INSPECTION: 'inspection',
  DIAGNOSIS: 'inspection',
  ESTIMATE: 'estimate',
  APPROVAL: 'approval',
  JOB_CARD: 'job-card',
  ASSIGNMENT: 'assignment',
  BAY: 'bay',
  WIP: 'wip',
  QC: 'qc',
  ROAD_TEST: 'qc',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  GATEPASS: 'gatepass',
  DELIVERY: 'delivery',
  FEEDBACK: 'feedback',
  PSF: 'psf',
}

export const STAGE_STATUSES = ['NOT_STARTED', 'CURRENT', 'COMPLETED', 'ON_HOLD', 'REJECTED', 'SKIPPED'] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const INSPECTION_CASE_STATUSES = [
  'PENDING_ASSIGNMENT',
  'ASSIGNED',
  'IN_PROGRESS',
  'PAUSED',
  'AWAITING_REVIEW',
  'REWORK_REQUIRED',
  'COMPLETED',
  'CANCELLED',
] as const
export type InspectionCaseStatus = (typeof INSPECTION_CASE_STATUSES)[number]

export const TRIAL_DISPOSITIONS = [
  'ROAD_TEST',
  'STATIC_TEST',
  'WORKSHOP_TEST',
  'NOT_SAFE',
  'NOT_REQUIRED',
  'NOT_POSSIBLE',
] as const
export type TrialDisposition = (typeof TRIAL_DISPOSITIONS)[number]

export const CHECKLIST_RESULTS = ['PASS', 'FAIL', 'ATTENTION', 'NOT_TESTED', 'NOT_APPLICABLE'] as const
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number]

export const FINDING_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

export const ESTIMATE_STATUSES = [
  'AWAITING_ESTIMATE',
  'DRAFT',
  'INTERNAL_REVIEW',
  'APPROVED_FOR_SHARING',
  'SENT_TO_CUSTOMER',
  'REVISION_REQUESTED',
  'PARTIALLY_APPROVED',
  'CUSTOMER_APPROVED',
  'REJECTED',
  'EXPIRED',
] as const
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number]

export const ESTIMATE_LINE_CATEGORIES = [
  'LABOUR',
  'PARTS',
  'LUBRICANT',
  'BATTERY',
  'TYRE',
  'DENTING_PAINTING',
  'ACCESSORY',
  'PICKUP',
  'DROP',
  'TOWING',
  'OTHER',
] as const
export type EstimateLineCategory = (typeof ESTIMATE_LINE_CATEGORIES)[number]

export const VOC_VERIFICATION_STATUSES = [
  'NOT_CHECKED',
  'REPRODUCED',
  'NOT_REPRODUCED',
  'INTERMITTENT',
  'FURTHER_TEST_REQUIRED',
  'RESOLVED_WITHOUT_REPAIR',
] as const
export type VocVerificationStatus = (typeof VOC_VERIFICATION_STATUSES)[number]

/** Legacy values retained for existing MongoDB rows. */
export const JOB_CARD_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'READY_FOR_ASSIGNMENT',
  'ASSIGNMENT_IN_PROGRESS',
  'ASSIGNED',
  'READY_TO_START',
  'WORK_COMPLETED',
  'READY_FOR_QC',
  'QC_IN_PROGRESS',
  'QC_FAILED',
  'QC_PASSED',
  'INVOICE_READY',
] as const
export type JobCardStatus = (typeof JOB_CARD_STATUSES)[number]

export const QC_CASE_STATUSES = [
  'AWAITING_QC',
  'INSPECTOR_ASSIGNED',
  'QC_IN_PROGRESS',
  'ROAD_TEST_PENDING',
  'QC_FAILED',
  'REWORK_IN_PROGRESS',
  'REINSPECTION_PENDING',
  'QC_PASSED',
  'RELEASED_FOR_INVOICE',
] as const
export type QcCaseStatus = (typeof QC_CASE_STATUSES)[number]

export const QC_QUEUE_TABS = [
  'AWAITING_QC',
  'INSPECTOR_ASSIGNED',
  'QC_IN_PROGRESS',
  'ROAD_TEST_PENDING',
  'QC_FAILED',
  'REWORK_IN_PROGRESS',
  'REINSPECTION_PENDING',
  'QC_PASSED',
  'RELEASED_FOR_INVOICE',
] as const
export type QcQueueTab = (typeof QC_QUEUE_TABS)[number]

export const QC_DECISIONS = ['PASS', 'FAIL', 'REWORK_REQUIRED', 'HOLD_FOR_REVIEW'] as const
export type QcDecision = (typeof QC_DECISIONS)[number]

export const QC_ROAD_TEST_DISPOSITIONS = [
  'REQUIRED',
  'COMPLETED',
  'NOT_REQUIRED',
  'NOT_SAFE',
  'NOT_POSSIBLE',
  'PENDING',
] as const
export type QcRoadTestDisposition = (typeof QC_ROAD_TEST_DISPOSITIONS)[number]

export const VOC_QC_RESOLUTION_STATUSES = [
  'RESOLVED',
  'NOT_RESOLVED',
  'INTERMITTENT',
  'NOT_REPRODUCED',
  'FURTHER_VERIFICATION_REQUIRED',
  'NOT_APPLICABLE',
] as const
export type VocQcResolutionStatus = (typeof VOC_QC_RESOLUTION_STATUSES)[number]

export const QC_QUANTITY_RESULTS = ['PASS', 'FAIL', 'ATTENTION', 'PENDING'] as const
export type QcQuantityResult = (typeof QC_QUANTITY_RESULTS)[number]

export const QC_REWORK_STATUSES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const
export type QcReworkStatus = (typeof QC_REWORK_STATUSES)[number]

export const FINAL_INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const
export type FinalInvoiceStatus = (typeof FINAL_INVOICE_STATUSES)[number]

export const INVOICE_PAYMENT_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
  'PAYMENT_PENDING_VERIFICATION',
  'CREDIT_AUTHORIZED',
  'OVERDUE',
] as const
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number]

export const GATE_PASS_STATUSES = ['DRAFT', 'READY_FOR_ISSUE', 'ISSUED', 'USED', 'VOID', 'EXPIRED'] as const
export type GatePassStatus = (typeof GATE_PASS_STATUSES)[number]

export const DELIVERY_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const BILLING_QUEUE_TABS = [
  'READY_FOR_INVOICE',
  'DRAFT_INVOICES',
  'ISSUED_INVOICES',
  'PAYMENT_PENDING',
  'CREDIT_CLEARANCE',
  'READY_FOR_GATE_PASS',
  'GATE_PASS_ISSUED',
  'PENDING_DELIVERY',
  'DELIVERED',
  'FEEDBACK_PENDING',
] as const
export type BillingQueueTab = (typeof BILLING_QUEUE_TABS)[number]

export const WORK_ASSIGNMENT_STATUSES = [
  'DRAFT',
  'ASSIGNED',
  'RELEASED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'REASSIGNED',
  'CANCELLED',
] as const
export type WorkAssignmentStatus = (typeof WORK_ASSIGNMENT_STATUSES)[number]

export const JOB_WORK_ITEM_STATUSES = [
  'PENDING',
  'ASSIGNED',
  'RELEASED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
] as const
export type JobWorkItemStatus = (typeof JOB_WORK_ITEM_STATUSES)[number]

export const WORKSHOP_LOCATION_TYPES = ['BAY', 'EXTRA_SPACE'] as const
export type WorkshopLocationType = (typeof WORKSHOP_LOCATION_TYPES)[number]

export const WORKSHOP_OPERATIONAL_ROLES = [
  'WORKSHOP_EXECUTIVE',
  'SERVICE_ADVISOR',
  'SUPERVISOR',
  'FLOOR_IN_CHARGE',
  'MECHANIC',
  'HELPER',
] as const
export type WorkshopOperationalRole = (typeof WORKSHOP_OPERATIONAL_ROLES)[number]

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'TRIAL'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]

/** Phase 4 — customer decision on issued estimate (canonical approval record). */
export const CUSTOMER_APPROVAL_STATUSES = [
  'PENDING',
  'FULLY_APPROVED',
  'PARTIALLY_APPROVED',
  'REVISION_REQUESTED',
  'REJECTED',
  'REVOKED',
] as const
export type CustomerApprovalStatus = (typeof CUSTOMER_APPROVAL_STATUSES)[number]

export const APPROVAL_SOURCES = [
  'IN_PERSON',
  'PHONE_CALL',
  'WHATSAPP',
  'EMAIL',
  'CUSTOMER_PORTAL',
  'SIGNED_DOCUMENT',
  'OTHER',
] as const
export type ApprovalSource = (typeof APPROVAL_SOURCES)[number]

export const FINANCIAL_AUTH_STATUSES = [
  'NOT_EVALUATED',
  'PENDING',
  'AUTHORIZED',
  'BLOCKED',
  'EXCEPTION_APPROVED',
] as const
export type FinancialAuthStatus = (typeof FINANCIAL_AUTH_STATUSES)[number]

export const VISIT_PAYMENT_STATES = [
  'NO_ADVANCE',
  'PENDING_VERIFICATION',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'REFUND_PENDING',
  'REFUNDED',
] as const
export type VisitPaymentState = (typeof VISIT_PAYMENT_STATES)[number]

export const ADVANCE_PAYMENT_MODES = [
  'CASH',
  'UPI',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BANK_TRANSFER',
  'CHEQUE',
  'OTHER',
] as const
export type AdvancePaymentMode = (typeof ADVANCE_PAYMENT_MODES)[number]

export const PAYMENT_VERIFICATION_STATUSES = [
  'INITIATED',
  'PENDING_VERIFICATION',
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const
export type PaymentVerificationStatus = (typeof PAYMENT_VERIFICATION_STATUSES)[number]

export const CREDIT_PROFILE_STATUSES = ['INACTIVE', 'ACTIVE', 'SUSPENDED', 'EXPIRED'] as const
export type CreditProfileStatus = (typeof CREDIT_PROFILE_STATUSES)[number]

export const APPROVAL_QUEUE_TABS = [
  'PENDING_CUSTOMER_APPROVAL',
  'FULLY_APPROVED',
  'PARTIALLY_APPROVED',
  'REVISION_REQUESTED',
  'REJECTED',
  'ADVANCE_RECEIVED',
  'CREDIT_AUTHORIZATION_PENDING',
  'AUTHORIZED_FOR_JOB_CARD',
] as const
export type ApprovalQueueTab = (typeof APPROVAL_QUEUE_TABS)[number]

/** Phase 6 — WIP record lifecycle */
export const WIP_RECORD_STATUSES = [
  'READY_TO_START',
  'IN_PROGRESS',
  'PARTIALLY_COMPLETED',
  'ON_HOLD',
  'AWAITING_PARTS',
  'ADDITIONAL_APPROVAL_PENDING',
  'WORK_COMPLETED',
  'READY_FOR_QC',
] as const
export type WipRecordStatus = (typeof WIP_RECORD_STATUSES)[number]

export const WIP_QUEUE_TABS = [
  'READY_TO_START',
  'IN_PROGRESS',
  'PARTIALLY_COMPLETED',
  'ON_HOLD',
  'AWAITING_PARTS',
  'ADDITIONAL_APPROVAL_PENDING',
  'COMPLETED',
  'READY_FOR_QC',
] as const
export type WipQueueTab = (typeof WIP_QUEUE_TABS)[number]

export const WIP_WORK_ITEM_EXECUTION_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PAUSED',
  'WAITING_FOR_PARTS',
  'WAITING_FOR_APPROVAL',
  'COMPLETED',
  'VERIFIED',
  'REWORK_REQUIRED',
  'CANCELLED',
] as const
export type WipWorkItemExecutionStatus = (typeof WIP_WORK_ITEM_EXECUTION_STATUSES)[number]

export const WORK_SESSION_STATUSES = ['ACTIVE', 'PAUSED', 'ENDED'] as const
export type WorkSessionStatus = (typeof WORK_SESSION_STATUSES)[number]

export const PARTS_REQUISITION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'PARTIALLY_ISSUED',
  'ISSUED',
  'CANCELLED',
  'CLOSED',
] as const
export type PartsRequisitionStatus = (typeof PARTS_REQUISITION_STATUSES)[number]

export const STOCK_TRANSACTION_TYPES = [
  'RESERVE',
  'RELEASE_RESERVATION',
  'ISSUE',
  'RETURN',
  'CONSUME',
  'ADJUSTMENT',
] as const
export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPES)[number]

export const ADDITIONAL_WORK_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'SUPERVISOR_REVIEW',
  'APPROVED_FOR_ESTIMATION',
  'ESTIMATE_PREPARED',
  'SENT_TO_CUSTOMER',
  'CUSTOMER_APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'INCORPORATED_IN_JOB_CARD',
  'CANCELLED',
] as const
export type AdditionalWorkStatus = (typeof ADDITIONAL_WORK_STATUSES)[number]

export const ESTIMATE_KINDS = ['PRIMARY', 'SUPPLEMENTARY'] as const
export type EstimateKind = (typeof ESTIMATE_KINDS)[number]

export const JOB_CARD_REVISION_SOURCES = ['INITIAL', 'SUPPLEMENTARY_APPROVAL'] as const
export type JobCardRevisionSource = (typeof JOB_CARD_REVISION_SOURCES)[number]

export function normalizeRegistrationNo(reg: string): string {
  return reg.replace(/\s+/g, '').toUpperCase()
}
