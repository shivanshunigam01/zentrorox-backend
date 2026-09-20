export const CUSTOMER_TYPES = ['INDIVIDUAL', 'FLEET', 'CORPORATE', 'INSURANCE'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

export const BOOKING_STATUSES = ['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'ARRIVED', 'NO_SHOW'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

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
  VOC: 'voc',
  INSPECTION: 'inspection',
  DIAGNOSIS: 'diagnosis',
  ESTIMATE: 'estimate',
  APPROVAL: 'approval',
  JOB_CARD: 'job-card',
  ASSIGNMENT: 'assignment',
  BAY: 'bay',
  WIP: 'wip',
  QC: 'qc',
  ROAD_TEST: 'road-test',
  INVOICE: 'invoice',
  PAYMENT: 'payment',
  GATEPASS: 'gatepass',
  DELIVERY: 'delivery',
  FEEDBACK: 'feedback',
  PSF: 'psf',
}

export const STAGE_STATUSES = ['NOT_STARTED', 'CURRENT', 'COMPLETED', 'ON_HOLD', 'REJECTED', 'SKIPPED'] as const
export type StageStatus = (typeof STAGE_STATUSES)[number]

export const JOB_CARD_STATUSES = ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const
export type JobCardStatus = (typeof JOB_CARD_STATUSES)[number]

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'TRIAL'] as const
export type TenantStatus = (typeof TENANT_STATUSES)[number]
