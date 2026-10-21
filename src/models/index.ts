import { Schema, model, type Types } from 'mongoose'
import {
  ARRIVAL_METHODS,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  CUSTOMER_TYPES,
  IMAGE_CATEGORIES,
  JOB_CARD_STATUSES,
  PICKUP_TASK_STATUSES,
  RECEIVING_STATUSES,
  SERVICE_STAGES,
  SERVICE_VISIT_STATUSES,
  STAGE_STATUSES,
  TENANT_STATUSES,
  VOC_CONFIRMATION_STATUSES,
  VOC_SOURCES,
  INSPECTION_CASE_STATUSES,
  JOB_WORK_ITEM_STATUSES,
  WORK_ASSIGNMENT_STATUSES,
  WORKSHOP_LOCATION_TYPES,
  WIP_RECORD_STATUSES,
  WIP_WORK_ITEM_EXECUTION_STATUSES,
  WORK_SESSION_STATUSES,
  PARTS_REQUISITION_STATUSES,
  STOCK_TRANSACTION_TYPES,
  ADDITIONAL_WORK_STATUSES,
  ESTIMATE_KINDS,
  CHECKLIST_RESULTS,
  FINDING_SEVERITIES,
  TRIAL_DISPOSITIONS,
  VOC_VERIFICATION_STATUSES,
  QC_CASE_STATUSES,
  QC_DECISIONS,
  QC_ROAD_TEST_DISPOSITIONS,
  VOC_QC_RESOLUTION_STATUSES,
  QC_QUANTITY_RESULTS,
  QC_REWORK_STATUSES,
  FINAL_INVOICE_STATUSES,
  INVOICE_PAYMENT_STATUSES,
  GATE_PASS_STATUSES,
  DELIVERY_STATUSES,
  CREDIT_NOTE_STATUSES,
  EINVOICE_IRN_STATUSES,
} from '../types/enums.js'

// ─── Tenant ──────────────────────────────────────────────────────

const tenantSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true },
  legalName: String,
  gstin: String,
  email: String,
  phone: String,
  address: String,
  city: String,
  state: String,
  pin: String,
  logoUrl: String,
  plan: { type: String, default: 'professional' },
  status: { type: String, enum: TENANT_STATUSES, default: 'ACTIVE' },
  eInvoicingSettings: {
    enabled: { type: Boolean, default: false },
    mandatoryFrom: Date,
    turnoverThresholdInr: { type: Number, default: 500000000 },
    b2bGstinRequired: { type: Boolean, default: true },
    provider: { type: String, default: 'GSP_HTTP' },
    gspBaseUrl: String,
    gspClientId: String,
    gspClientSecret: String,
    nicUsername: String,
  },
}, { timestamps: true })

// ─── Auth / RBAC ─────────────────────────────────────────────────

const permissionSchema = new Schema({
  module: { type: String, required: true },
  action: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  description: String,
}, { timestamps: { createdAt: true, updatedAt: false } })

const roleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null },
  name: { type: String, required: true },
  code: { type: String, required: true },
  description: String,
  isSystem: { type: Boolean, default: false },
  permissionCodes: [{ type: String }],
}, { timestamps: true })
roleSchema.index({ tenantId: 1, code: 1 }, { unique: true })

const userSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  email: { type: String, required: true },
  mobile: String,
  userId: String,
  passwordHash: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: String,
  roleId: { type: Schema.Types.ObjectId, ref: 'Role' },
  branchIds: [{ type: Schema.Types.ObjectId, ref: 'Branch' }],
  isActive: { type: Boolean, default: true },
  isPlatformAdmin: { type: Boolean, default: false },
  lastLoginAt: Date,
  failedLogins: { type: Number, default: 0 },
  lockedUntil: Date,
  employeeCode: String,
  metadata: Schema.Types.Mixed,
  workshopProfile: {
    designation: String,
    primaryOperationalRole: String,
    additionalOperationalRoles: [String],
    skillCategories: [String],
    skillLevel: String,
    vehicleCategorySpecialization: [String],
    assignedShift: String,
    reportingManagerId: { type: Schema.Types.ObjectId, ref: 'User' },
    availabilityStatus: { type: String, default: 'AVAILABLE' },
    maxConcurrentWorkload: { type: Number, default: 3 },
    employmentStatus: { type: String, default: 'ACTIVE' },
    inspectorCode: String,
    qcQualification: String,
    roadTestAuthorized: { type: Boolean, default: false },
    drivingLicenceNumber: String,
    drivingLicenceClass: String,
    drivingLicenceExpiry: Date,
  },
}, { timestamps: true })
userSchema.index({ tenantId: 1, email: 1 }, { unique: true })

const refreshTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } })

// ─── CRM ─────────────────────────────────────────────────────────

const customerSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  code: { type: String, required: true },
  type: { type: String, enum: CUSTOMER_TYPES, default: 'INDIVIDUAL' },
  name: { type: String, required: true },
  mobile: { type: String, required: true },
  alternateMobile: String,
  email: String,
  gstin: String,
  address: String,
  city: String,
  state: String,
  pin: String,
  creditLimit: Number,
  creditDays: Number,
  pan: String,
  customerStatus: { type: String, default: 'ACTIVE' },
  accountOwnerId: { type: Schema.Types.ObjectId, ref: 'User' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
customerSchema.index({ tenantId: 1, code: 1 }, { unique: true })

const vehicleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  registrationNo: { type: String, required: true },
  vin: String,
  chassisNo: String,
  engineNo: String,
  make: { type: String, required: true },
  model: { type: String, required: true },
  variant: String,
  subVariant: String,
  fuelType: String,
  transmission: String,
  colour: String,
  manufacturingYear: Number,
  registrationDate: Date,
  odometer: { type: Number, default: 0 },
  vehicleCategory: String,
  imageUrl: String,
  imagePublicId: String,
  isActive: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
vehicleSchema.index({ tenantId: 1, registrationNo: 1 }, { unique: true })

// ─── Service Visit ───────────────────────────────────────────────

const stageLogSchema = new Schema({
  stage: { type: String, enum: SERVICE_STAGES, required: true },
  status: { type: String, enum: STAGE_STATUSES, default: 'NOT_STARTED' },
  startedAt: Date,
  completedAt: Date,
  completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  remarks: String,
}, { _id: true })

const serviceVisitSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  visitNumber: { type: String, required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  jobCardNumber: String,
  advisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  currentStage: { type: String, enum: SERVICE_STAGES, default: 'BOOKING' },
  status: { type: String, enum: SERVICE_VISIT_STATUSES, default: 'OPEN' },
  promiseTime: Date,
  odometer: Number,
  fuelLevel: String,
  outstanding: { type: Number, default: 0 },
  remarks: String,
  inspectionImages: [{
    url: String,
    publicId: String,
    caption: String,
    uploadedAt: { type: Date, default: Date.now },
  }],
  pickupRequired: { type: Boolean, default: false },
  pickupAddress: String,
  pickupLocationLat: Number,
  pickupLocationLng: Number,
  pickupExecutiveId: { type: Schema.Types.ObjectId, ref: 'User' },
  pickupAssignedAt: Date,
  pickupCompletedAt: Date,
  pickupImages: [{
    type: { type: String, required: true },
    url: { type: String, required: true },
    publicId: String,
    caption: String,
    latitude: Number,
    longitude: Number,
    capturedAt: { type: Date, required: true },
    uploadedAt: { type: Date, default: Date.now },
  }],
  stageLogs: [stageLogSchema],
  finalQcOdometer: Number,
  invoiceReady: { type: Boolean, default: false },
  qcPassedAt: Date,
  deliveredAt: Date,
  serviceClosedAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
serviceVisitSchema.index({ tenantId: 1, visitNumber: 1 }, { unique: true })

const breakdownDetailsSchema = new Schema({
  breakdownAt: Date,
  address: String,
  mapsLink: String,
  latitude: Number,
  longitude: Number,
  landmark: String,
  vehicleCondition: String,
  drivable: { type: String, enum: ['YES', 'NO', 'UNKNOWN'] },
  engineStarts: { type: String, enum: ['YES', 'NO', 'UNKNOWN'] },
  symptoms: String,
  safetyNotes: String,
  contactAtLocation: String,
  towRequired: { type: Boolean, default: true },
  assistancePriority: String,
  assistanceNotes: String,
  recoveryPartner: String,
  estimatedPickupTime: Date,
  dispatchNotes: String,
}, { _id: false })

const bookingSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  bookingNumber: { type: String, required: true },
  bookingDate: { type: Date, required: true },
  bookingType: { type: String, enum: BOOKING_TYPES, default: 'NORMAL' },
  arrivalMethod: { type: String, enum: ARRIVAL_METHODS, default: 'SELF' },
  bookingCharge: { type: Number, default: 0 },
  source: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  serviceType: String,
  customerComplaint: String,
  customerPriority: String,
  preferredDate: Date,
  preferredSlot: String,
  pickupRequired: { type: Boolean, default: false },
  pickupAddress: String,
  pickupLocationLat: Number,
  pickupLocationLng: Number,
  breakdownDetails: breakdownDetailsSchema,
  advisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  expectedArrival: Date,
  remarks: String,
  status: { type: String, enum: BOOKING_STATUSES, default: 'CONFIRMED' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit' },
  completedGateInAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
bookingSchema.index({ tenantId: 1, bookingNumber: 1 }, { unique: true })
bookingSchema.index({ tenantId: 1, branchId: 1, status: 1, bookingDate: -1 })
bookingSchema.index({ tenantId: 1, vehicleId: 1, status: 1 })

const pickupTaskSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  visitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit' },
  status: { type: String, enum: PICKUP_TASK_STATUSES, default: 'UNASSIGNED' },
  driverId: { type: Schema.Types.ObjectId, ref: 'User' },
  recoveryVehicleLabel: String,
  recoveryPartner: String,
  pickupAddress: String,
  pickupLocationLat: Number,
  pickupLocationLng: Number,
  scheduledPickupTime: Date,
  assignedAt: Date,
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  dispatchNotes: String,
  actualArrivalAt: Date,
  actualPickupAt: Date,
  pickupOdometer: Number,
  handoverAt: Date,
  handoverNotes: String,
}, { timestamps: true })
pickupTaskSchema.index({ tenantId: 1, branchId: 1, status: 1 })
pickupTaskSchema.index({ tenantId: 1, bookingId: 1 }, { unique: true })

const inventoryChecklistItemSchema = new Schema({
  masterItemId: String,
  category: String,
  code: String,
  label: { type: String, required: true },
  status: { type: String, enum: ['PRESENT', 'MISSING', 'DAMAGED', 'NOT_APPLICABLE', 'NOT_CHECKED'], default: 'NOT_CHECKED' },
  quantity: Number,
  remarks: String,
  imageMediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
  checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedAt: Date,
}, { _id: true })

const receivingRecordSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  visitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  receivingStatus: { type: String, enum: RECEIVING_STATUSES, default: 'DRAFT' },
  observedArrivalAt: Date,
  recordedAt: { type: Date, default: Date.now },
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  customerAcknowledged: { type: Boolean, default: false },
  odometer: Number,
  odometerUnit: { type: String, enum: ['KM', 'MILES'], default: 'KM' },
  fuelLevel: String,
  observedEngineNo: String,
  observedChassisNo: String,
  engineMatchStatus: { type: String, enum: ['MATCH', 'MISMATCH', 'UNREADABLE', 'NOT_CHECKED'], default: 'NOT_CHECKED' },
  chassisMatchStatus: { type: String, enum: ['MATCH', 'MISMATCH', 'UNREADABLE', 'NOT_CHECKED'], default: 'NOT_CHECKED' },
  verificationRemarks: String,
  keyReceived: Boolean,
  keyCount: Number,
  handoverPersonName: String,
  vehicleConditionRemarks: String,
  receivingRemarks: String,
  inventoryItems: [inventoryChecklistItemSchema],
  exceptionFlags: [String],
  completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date,
}, { timestamps: true })
receivingRecordSchema.index({ tenantId: 1, visitId: 1 }, { unique: true })
receivingRecordSchema.index({ tenantId: 1, branchId: 1, receivingStatus: 1 })

const vocComplaintSchema = new Schema({
  title: String,
  description: { type: String, required: true },
  symptoms: String,
  occurrence: String,
  problemStarted: String,
  drivingConditions: String,
  conditionWhenObserved: String,
  requestedWork: String,
  priority: String,
  symptomType: String,
  source: { type: String, enum: VOC_SOURCES, required: true },
  reportedBy: String,
  enteredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  customerRemarks: String,
  attachmentMediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  isPreventiveMaintenance: { type: Boolean, default: false },
  status: { type: String, enum: ['DRAFT', 'CONFIRMED'], default: 'DRAFT' },
}, { timestamps: true })

const vocRecordSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  visitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  confirmationStatus: { type: String, enum: VOC_CONFIRMATION_STATUSES, default: 'DRAFT' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  complaints: [vocComplaintSchema],
}, { timestamps: true })
vocRecordSchema.index({ tenantId: 1, visitId: 1 }, { unique: true })

const inspectionChecklistSnapshotSchema = new Schema({
  masterItemId: String,
  category: String,
  code: String,
  label: { type: String, required: true },
  method: String,
  expectedStandard: String,
  inputType: { type: String, default: 'dropdown' },
  required: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
})

const inspectionChecklistResponseSchema = new Schema({
  snapshotItemId: { type: Schema.Types.ObjectId },
  result: { type: String, enum: CHECKLIST_RESULTS, default: 'NOT_TESTED' },
  actualValue: String,
  measurementUnit: String,
  remarks: String,
  severity: String,
  evidenceMediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  linkedVocComplaintIds: [String],
  checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedAt: Date,
})

const trialObservationSchema = new Schema({
  system: String,
  observationKey: String,
  status: { type: String, enum: ['NORMAL', 'ABNORMAL', 'NOT_TESTED', 'NOT_APPLICABLE'] },
  description: String,
  severity: String,
  notes: String,
  linkedVocComplaintId: String,
  evidenceMediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
})

const inspectionTrialSchema = new Schema({
  trialReference: String,
  disposition: { type: String, enum: TRIAL_DISPOSITIONS },
  skipReason: String,
  trialType: String,
  trialDate: Date,
  startTime: String,
  endTime: String,
  startOdometer: Number,
  endOdometer: Number,
  driverName: String,
  accompanyingPerson: String,
  fuelLevel: String,
  routeArea: String,
  roadConditions: String,
  weatherConditions: String,
  purpose: String,
  observedSymptoms: String,
  remarks: String,
  status: { type: String, default: 'DRAFT' },
  observations: [trialObservationSchema],
})

const technicalFindingSchema = new Schema({
  source: { type: String, default: 'CHECKLIST' },
  linkedVocComplaintIds: [String],
  vehicleSystem: String,
  component: String,
  observedFailure: String,
  symptoms: String,
  testPerformed: String,
  measuredValues: String,
  referenceSpec: String,
  probableCause: String,
  confirmedCause: String,
  diagnosisConfidence: { type: String, enum: ['SUSPECTED', 'PROBABLE', 'CONFIRMED'], default: 'SUSPECTED' },
  faultCode: String,
  severity: { type: String, enum: FINDING_SEVERITIES },
  safetyImpact: String,
  vehicleOperability: String,
  inspectorNotes: String,
  evidenceMediaIds: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  recommendations: [String],
  partsRequired: [String],
  furtherTestingRequired: { type: Boolean, default: false },
  findingStatus: { type: String, default: 'OPEN' },
})

const inspectionReviewSchema = new Schema({
  reportVersion: Number,
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
  decision: { type: String, enum: ['APPROVED', 'REWORK'] },
  comments: String,
  reworkInstructions: String,
  reviewedAt: Date,
})

const assignmentHistorySchema = new Schema({
  inspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt: Date,
  reason: String,
  previousInspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
})

const vocVerificationSchema = new Schema({
  complaintId: { type: String, required: true },
  status: { type: String, enum: VOC_VERIFICATION_STATUSES, default: 'NOT_CHECKED' },
  notes: String,
})

const inspectorReportSchema = new Schema({
  overallVehicleCondition: String,
  trialSummary: String,
  inspectionSummary: String,
  complaintVerificationSummary: String,
  confirmedFaults: String,
  suspectedFaults: String,
  safetyCriticalFindings: String,
  recommendedRepairs: String,
  recommendedReplacements: String,
  additionalTestingRequired: String,
  urgentAttentionRequired: Boolean,
  vehicleSafeToOperate: { type: String, enum: ['YES', 'NO', 'UNDETERMINED'] },
  inspectorRemarks: String,
  completedAt: Date,
})

const inspectionCaseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  inspectionNumber: { type: String, required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  status: { type: String, enum: INSPECTION_CASE_STATUSES, default: 'PENDING_ASSIGNMENT' },
  inspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewerId: { type: Schema.Types.ObjectId, ref: 'User' },
  priority: { type: String, default: 'NORMAL' },
  plannedInspectionAt: Date,
  plannedStartTime: String,
  expectedCompletionTime: String,
  assignmentInstructions: String,
  assignmentHistory: [assignmentHistorySchema],
  startedAt: Date,
  submittedAt: Date,
  approvedAt: Date,
  checklistSnapshot: [inspectionChecklistSnapshotSchema],
  checklistResponses: [inspectionChecklistResponseSchema],
  activeChecklistVersion: { type: Number, default: 1 },
  trial: inspectionTrialSchema,
  findings: [technicalFindingSchema],
  vocVerifications: [vocVerificationSchema],
  inspectorReport: inspectorReportSchema,
  reviews: [inspectionReviewSchema],
  reportVersion: { type: Number, default: 0 },
}, { timestamps: true })
inspectionCaseSchema.index({ tenantId: 1, serviceVisitId: 1 }, { unique: true })
inspectionCaseSchema.index({ tenantId: 1, branchId: 1, status: 1 })
inspectionCaseSchema.index({ tenantId: 1, inspectionNumber: 1 }, { unique: true })

const taxRuleSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  ruleName: { type: String, required: true },
  hsnSac: String,
  goodsServiceCategory: String,
  gstPercent: { type: Number, required: true },
  cgstPercent: Number,
  sgstPercent: Number,
  igstPercent: Number,
  taxInclusive: { type: Boolean, default: false },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: Date,
  jurisdiction: String,
  active: { type: Boolean, default: true },
  approvalStatus: { type: String, enum: ['APPROVED', 'PENDING', 'REJECTED'], default: 'APPROVED' },
  legalReference: String,
  remarks: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
taxRuleSchema.index({ tenantId: 1, hsnSac: 1, effectiveFrom: -1 })

const discountPolicySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  description: String,
  discountType: { type: String, enum: ['PERCENTAGE', 'FIXED'], required: true },
  discountValue: { type: Number, required: true },
  applicableCategories: [String],
  minAmount: Number,
  maxDiscountCap: Number,
  startDate: Date,
  endDate: Date,
  active: { type: Boolean, default: true },
  stackable: { type: Boolean, default: false },
  beforeTax: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: false },
  approvalThresholdPercent: Number,
  authorizedRoles: [String],
}, { timestamps: true })
discountPolicySchema.index({ tenantId: 1, code: 1 }, { unique: true })

const estimateLineSchema = new Schema({
  lineId: { type: String, required: true },
  category: { type: String, required: true },
  masterItemId: String,
  itemCode: String,
  description: { type: String, required: true },
  linkedFindingIds: [String],
  quantity: { type: Number, default: 1 },
  uom: { type: String, default: 'NOS' },
  unitRate: { type: Number, default: 0 },
  labourHours: Number,
  labourRate: Number,
  grossAmount: { type: Number, default: 0 },
  discountCode: String,
  discountType: String,
  discountAmount: { type: Number, default: 0 },
  taxableAmount: { type: Number, default: 0 },
  hsnSac: String,
  taxRuleId: String,
  effectiveGstRate: Number,
  cgstAmount: { type: Number, default: 0 },
  sgstAmount: { type: Number, default: 0 },
  igstAmount: { type: Number, default: 0 },
  finalAmount: { type: Number, default: 0 },
  itemNotes: String,
  optional: { type: Boolean, default: false },
  customerApprovalStatus: { type: String, default: 'PENDING' },
})

const estimateTotalsSchema = new Schema({
  labourSubtotal: Number,
  partsSubtotal: Number,
  lubricantSubtotal: Number,
  batterySubtotal: Number,
  tyreSubtotal: Number,
  dentingPaintingSubtotal: Number,
  accessoriesSubtotal: Number,
  logisticsSubtotal: Number,
  grossAmount: Number,
  totalDiscount: Number,
  taxableAmount: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  roundingAdjustment: Number,
  finalAmount: Number,
}, { _id: false })

const estimateRevisionSchema = new Schema({
  revisionNumber: { type: Number, required: true },
  items: [estimateLineSchema],
  totals: estimateTotalsSchema,
  terms: String,
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  frozen: { type: Boolean, default: false },
  pdfUrl: String,
  taxSnapshots: [Schema.Types.Mixed],
  discountSnapshots: [Schema.Types.Mixed],
})

const estimateApprovalSchema = new Schema({
  revisionNumber: Number,
  actorType: { type: String, enum: ['INTERNAL', 'CUSTOMER'] },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  decision: String,
  approvedLineIds: [String],
  rejectedLineIds: [String],
  verificationMethod: String,
  customerRemarks: String,
  decidedAt: { type: Date, default: Date.now },
})

const estimateSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  inspectionCaseId: { type: Schema.Types.ObjectId, ref: 'InspectionCase' },
  estimateNumber: { type: String, required: true },
  estimateKind: { type: String, enum: ESTIMATE_KINDS, default: 'PRIMARY' },
  parentEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard' },
  additionalWorkRequestId: { type: Schema.Types.ObjectId, ref: 'AdditionalWorkRequest' },
  status: { type: String, default: 'DRAFT' },
  currentRevisionNumber: { type: Number, default: 1 },
  revisions: [estimateRevisionSchema],
  approvals: [estimateApprovalSchema],
  assignedAdvisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  validUntil: Date,
  version: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
estimateSchema.index({ tenantId: 1, serviceVisitId: 1, estimateKind: 1 }, { unique: true })
estimateSchema.index({ tenantId: 1, estimateNumber: 1 }, { unique: true })
estimateSchema.index({ tenantId: 1, branchId: 1, status: 1 })

const estimateCommunicationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate', required: true },
  revisionNumber: Number,
  channel: { type: String, enum: ['EMAIL', 'WHATSAPP', 'MANUAL'] },
  recipient: String,
  providerReference: String,
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'DELIVERY_CONFIRMED'], default: 'PENDING' },
  errorDetails: String,
}, { timestamps: true })

const customerCreditProfileSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  creditAllowed: { type: Boolean, default: false },
  creditLimit: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
  creditPeriodDays: { type: Number, default: 0 },
  effectiveFrom: Date,
  effectiveTo: Date,
  status: { type: String, default: 'INACTIVE' },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  remarks: String,
  creditHold: { type: Boolean, default: false },
  creditHoldReason: String,
  policyReference: String,
  provisionalExposureNote: { type: String, default: 'Exposure is provisional until invoicing is posted.' },
}, { timestamps: true })
customerCreditProfileSchema.index({ tenantId: 1, customerId: 1 }, { unique: true })

const paymentPolicySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  code: { type: String, required: true },
  name: { type: String, required: true },
  customerCategory: String,
  creditEligibilityRequired: { type: Boolean, default: false },
  minimumAdvanceType: { type: String, enum: ['NONE', 'FIXED', 'PERCENTAGE'], default: 'NONE' },
  minimumAdvancePercentage: Number,
  minimumAdvanceAmount: Number,
  allowZeroAdvance: { type: Boolean, default: true },
  creditExposureCheck: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: false },
  effectiveFrom: Date,
  effectiveTo: Date,
  active: { type: Boolean, default: true },
}, { timestamps: true })
paymentPolicySchema.index({ tenantId: 1, code: 1 }, { unique: true })

const customerApprovalSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  approvalReference: { type: String, required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate', required: true },
  estimateRevisionNumber: { type: Number, required: true },
  estimateAmount: { type: Number, default: 0 },
  approvalType: { type: String, required: true },
  approvedAmount: { type: Number, default: 0 },
  rejectedAmount: { type: Number, default: 0 },
  selectedApprovedLineIds: [String],
  approvalSource: String,
  customerRemarks: String,
  advisorRemarks: String,
  approvalStatus: { type: String, default: 'PENDING' },
  customerVerificationMethod: String,
  staffRecorded: { type: Boolean, default: true },
  evidenceReferences: [String],
  termsAccepted: { type: Boolean, default: false },
  confirmationReference: String,
  contactedNumber: String,
  callDateTime: Date,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  recordedAt: Date,
  idempotencyKey: String,
  history: [{
    action: String,
    at: Date,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    snapshot: Schema.Types.Mixed,
  }],
}, { timestamps: true })
customerApprovalSchema.index({ tenantId: 1, approvalReference: 1 }, { unique: true })
customerApprovalSchema.index({ tenantId: 1, serviceVisitId: 1, estimateRevisionNumber: 1 })
customerApprovalSchema.index({ tenantId: 1, branchId: 1, approvalStatus: 1 })

const advancePaymentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  advanceReference: { type: String, required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
  estimateRevisionNumber: Number,
  approvedAmount: Number,
  receivedAmount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  paymentMode: { type: String, required: true },
  paymentReference: String,
  verificationStatus: { type: String, default: 'PENDING_VERIFICATION' },
  paymentDate: Date,
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedAt: Date,
  confirmedAt: Date,
  bankUpiReference: String,
  remarks: String,
  attachmentUrl: String,
  allocationAmount: Number,
  unallocatedAmount: Number,
  idempotencyKey: String,
  reversedAt: Date,
  reversedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reversalReason: String,
}, { timestamps: true })
advancePaymentSchema.index({ tenantId: 1, advanceReference: 1 }, { unique: true })
advancePaymentSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })
advancePaymentSchema.index({ tenantId: 1, serviceVisitId: 1 })

const receiptSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  advancePaymentId: { type: Schema.Types.ObjectId, ref: 'AdvancePayment', required: true },
  receiptNumber: { type: String, required: true },
  documentType: { type: String, default: 'ADVANCE_PAYMENT_RECEIPT' },
  documentSnapshot: Schema.Types.Mixed,
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
receiptSchema.index({ tenantId: 1, receiptNumber: 1 }, { unique: true })

const receiptCommunicationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  receiptId: { type: Schema.Types.ObjectId, ref: 'Receipt', required: true },
  channel: { type: String, enum: ['EMAIL', 'WHATSAPP', 'MANUAL'] },
  recipient: String,
  status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'DELIVERY_CONFIRMED'], default: 'PENDING' },
  providerReference: String,
  errorDetails: String,
}, { timestamps: true })

const financialAuthorizationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  customerApprovalId: { type: Schema.Types.ObjectId, ref: 'CustomerApproval' },
  approvedEstimateRevisionId: Number,
  approvedScopeAmount: Number,
  paymentPolicyId: { type: Schema.Types.ObjectId, ref: 'PaymentPolicy' },
  creditAssessment: Schema.Types.Mixed,
  financialAuthStatus: { type: String, default: 'NOT_EVALUATED' },
  paymentState: { type: String, default: 'NO_ADVANCE' },
  confirmedAdvanceTotal: { type: Number, default: 0 },
  remainingPlannedAmount: { type: Number, default: 0 },
  jobCardAuthorized: { type: Boolean, default: false },
  jobCardAuthorizedAt: Date,
  jobCardAuthorizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  exceptionApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  exceptionReason: String,
  exceptionExpiresAt: Date,
}, { timestamps: true })
financialAuthorizationSchema.index({ tenantId: 1, serviceVisitId: 1 }, { unique: true })

const deliveryRevisionSchema = new Schema({
  previousPromise: Date,
  newPromise: Date,
  reason: String,
  revisedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  revisedAt: Date,
}, { _id: false })

const jobCardSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  estimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
  approvedEstimateRevisionNumber: Number,
  customerApprovalId: { type: Schema.Types.ObjectId, ref: 'CustomerApproval' },
  financialAuthorizationId: { type: Schema.Types.ObjectId, ref: 'FinancialAuthorization' },
  jobCardNumber: { type: String, required: true },
  jobType: String,
  promiseDate: Date,
  advisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  workshopExecutiveId: { type: Schema.Types.ObjectId, ref: 'User' },
  supervisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  floorInChargeId: { type: Schema.Types.ObjectId, ref: 'User' },
  bayId: { type: Schema.Types.ObjectId, ref: 'Bay' },
  priority: String,
  approvedValue: Number,
  currentValue: Number,
  status: { type: String, enum: JOB_CARD_STATUSES, default: 'READY_FOR_ASSIGNMENT' },
  holdReason: String,
  instructions: String,
  workPlannedStart: Date,
  workActualStart: Date,
  internalTargetCompletion: Date,
  customerPromisedDelivery: Date,
  actualWorkCompletion: Date,
  jobCardRemarks: String,
  revisionNumber: { type: Number, default: 1 },
  currentRevisionId: { type: Schema.Types.ObjectId, ref: 'JobCardRevision' },
  supplementaryApprovedValue: { type: Number, default: 0 },
  deliveryPlan: {
    customerRequestedDelivery: Date,
    workshopPlannedStart: Date,
    estimatedLabourHours: Number,
    earliestFeasibleCompletion: Date,
    suggestedDelivery: Date,
    committedDelivery: Date,
    commitmentSetBy: { type: Schema.Types.ObjectId, ref: 'User' },
    commitmentSetAt: Date,
    deliveryRemarks: String,
    delayRisk: String,
    requiresManagerConfirmation: { type: Boolean, default: false },
    revisionHistory: [deliveryRevisionSchema],
  },
  idempotencyKey: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
jobCardSchema.index({ tenantId: 1, jobCardNumber: 1 }, { unique: true })
jobCardSchema.index({ tenantId: 1, serviceVisitId: 1 }, { unique: true })
jobCardSchema.index({ tenantId: 1, branchId: 1, status: 1 })

const jobWorkItemSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  estimateLineId: { type: String, required: true },
  workItemCode: String,
  category: String,
  description: { type: String, required: true },
  approvedQuantity: { type: Number, default: 1 },
  uom: String,
  standardLabourHours: Number,
  requiredSkills: [String],
  requiredPartCodes: [String],
  workPriority: String,
  dependencyWorkItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
  status: { type: String, enum: JOB_WORK_ITEM_STATUSES, default: 'PENDING' },
  assignedTeamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
  locationId: { type: Schema.Types.ObjectId, ref: 'WorkshopLocation' },
  plannedStart: Date,
  plannedFinish: Date,
  actualStart: Date,
  actualFinish: Date,
  jobCardRevisionNumber: { type: Number, default: 1 },
  inspectionFindingId: String,
  operationCode: String,
  assignedMechanicId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedHelperId: { type: Schema.Types.ObjectId, ref: 'User' },
  executionStatus: { type: String, enum: WIP_WORK_ITEM_EXECUTION_STATUSES, default: 'NOT_STARTED' },
  workCompleted: { type: Boolean, default: false },
  completionPercent: { type: Number, default: 0 },
  workDoneDescription: String,
  technicianRemarks: String,
  supervisorRemarks: String,
  photosBefore: [{ url: String, publicId: String, uploadedAt: Date }],
  photosDuring: [{ url: String, publicId: String, uploadedAt: Date }],
  photosAfter: [{ url: String, publicId: String, uploadedAt: Date }],
  qcRequired: { type: Boolean, default: true },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date,
  actualLabourMinutes: { type: Number, default: 0 },
  standardLabourMinutes: Number,
  chargeable: { type: Boolean, default: true },
  supplementaryEstimateLineId: String,
}, { timestamps: true })
jobWorkItemSchema.index({ tenantId: 1, jobCardId: 1 })
jobWorkItemSchema.index({ tenantId: 1, jobCardId: 1, estimateLineId: 1 }, { unique: true })

const workshopTeamSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  teamCode: { type: String, required: true },
  name: { type: String, required: true },
  specialization: String,
  teamLeadId: { type: Schema.Types.ObjectId, ref: 'User' },
  supervisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  defaultFloorInChargeId: { type: Schema.Types.ObjectId, ref: 'User' },
  memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  memberRoles: Schema.Types.Mixed,
  vehicleSpecialization: [String],
  shift: String,
  capacity: { type: Number, default: 5 },
  isActive: { type: Boolean, default: true },
  effectiveFrom: Date,
  remarks: String,
}, { timestamps: true })
workshopTeamSchema.index({ tenantId: 1, branchId: 1, teamCode: 1 }, { unique: true })

const workAssignmentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  workItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
  teamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
  serviceAdvisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  supervisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  floorInChargeId: { type: Schema.Types.ObjectId, ref: 'User' },
  leadMechanicId: { type: Schema.Types.ObjectId, ref: 'User' },
  mechanicIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  helperIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  locationId: { type: Schema.Types.ObjectId, ref: 'WorkshopLocation' },
  assignmentPriority: String,
  assignedAt: Date,
  plannedStart: Date,
  plannedFinish: Date,
  plannedLabourHours: Number,
  workInstructions: String,
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: WORK_ASSIGNMENT_STATUSES, default: 'DRAFT' },
  remarks: String,
  history: [{
    action: String,
    at: Date,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    fromTeamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
    toTeamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
    reason: String,
    snapshot: Schema.Types.Mixed,
  }],
}, { timestamps: true })
workAssignmentSchema.index({ tenantId: 1, jobCardId: 1 })

const workshopLocationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  locationType: { type: String, enum: WORKSHOP_LOCATION_TYPES, required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  bayId: { type: Schema.Types.ObjectId, ref: 'Bay' },
  description: String,
  allowedWorkTypes: [String],
  vehicleCategoryRestrictions: [String],
  capacity: { type: Number, default: 1 },
  exclusiveUse: { type: Boolean, default: true },
  safetyConstraints: String,
  operationalStatus: { type: String, default: 'AVAILABLE' },
  maintenanceStatus: { type: String, default: 'OK' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
workshopLocationSchema.index({ tenantId: 1, branchId: 1, code: 1 }, { unique: true })

const locationReservationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  locationId: { type: Schema.Types.ObjectId, ref: 'WorkshopLocation', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  assignmentId: { type: Schema.Types.ObjectId, ref: 'WorkAssignment' },
  plannedStart: Date,
  plannedEnd: Date,
  actualOccupancyStart: Date,
  actualRelease: Date,
  status: { type: String, default: 'RESERVED' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  remarks: String,
}, { timestamps: true })
locationReservationSchema.index({ tenantId: 1, locationId: 1, plannedStart: 1, plannedEnd: 1 })

const baySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  bayType: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
baySchema.index({ tenantId: 1, branchId: 1, code: 1 }, { unique: true })

// ─── Inventory ───────────────────────────────────────────────────

const partSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  partNumber: { type: String, required: true },
  description: { type: String, required: true },
  category: String,
  brand: String,
  uom: { type: String, default: 'NOS' },
  hsn: String,
  gstPercent: Number,
  mrp: Number,
  imageUrl: String,
  imagePublicId: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
partSchema.index({ tenantId: 1, partNumber: 1 }, { unique: true })

const warehouseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
warehouseSchema.index({ tenantId: 1, code: 1 }, { unique: true })

const stockBalanceSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  onHand: { type: Number, default: 0 },
  available: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  issuedToWip: { type: Number, default: 0 },
  reorderLevel: { type: Number, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } })
stockBalanceSchema.index({ partId: 1, warehouseId: 1 }, { unique: true })

const wipRecordSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  status: { type: String, enum: WIP_RECORD_STATUSES, default: 'READY_TO_START' },
  startedAt: Date,
  completedAt: Date,
  progressSummary: {
    totalWorkItems: { type: Number, default: 0 },
    completedWorkItems: { type: Number, default: 0 },
    inProgressWorkItems: { type: Number, default: 0 },
    completionPercent: { type: Number, default: 0 },
  },
  holdReason: String,
  partsHold: { type: Boolean, default: false },
  additionalApprovalPending: { type: Boolean, default: false },
}, { timestamps: true })
wipRecordSchema.index({ tenantId: 1, jobCardId: 1 }, { unique: true })
wipRecordSchema.index({ tenantId: 1, branchId: 1, status: 1 })

const workSessionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  workItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem', required: true },
  technicianId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  teamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
  startTime: { type: Date, required: true },
  pauseTime: Date,
  resumeTime: Date,
  endTime: Date,
  pauseReason: String,
  actualLabourMinutes: { type: Number, default: 0 },
  status: { type: String, enum: WORK_SESSION_STATUSES, default: 'ACTIVE' },
  notes: String,
  corrections: [{
    field: String,
    previousValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed,
    reason: String,
    correctedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    correctedAt: Date,
  }],
}, { timestamps: true })
workSessionSchema.index({ tenantId: 1, workItemId: 1, technicianId: 1, status: 1 })

const requisitionLineSchema = new Schema({
  partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
  partNumber: String,
  description: String,
  uom: String,
  quantityRequested: { type: Number, required: true },
  quantityApproved: { type: Number, default: 0 },
  quantityIssued: { type: Number, default: 0 },
  quantityReturned: { type: Number, default: 0 },
  quantityConsumed: { type: Number, default: 0 },
  estimateLineId: String,
  chargeable: { type: Boolean, default: true },
  approvedSellingPrice: Number,
  workItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
}, { _id: true })

const partsRequisitionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  requisitionNumber: { type: String, required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  jobCardRevisionNumber: { type: Number, default: 1 },
  workItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestedAt: { type: Date, default: Date.now },
  requiredDate: Date,
  priority: String,
  remarks: String,
  status: { type: String, enum: PARTS_REQUISITION_STATUSES, default: 'DRAFT' },
  lines: [requisitionLineSchema],
  approvalHistory: [{
    action: String,
    at: Date,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    remarks: String,
  }],
  idempotencyKey: String,
}, { timestamps: true })
partsRequisitionSchema.index({ tenantId: 1, requisitionNumber: 1 }, { unique: true })
partsRequisitionSchema.index({ tenantId: 1, jobCardId: 1 })

const stockLedgerSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
  transactionType: { type: String, enum: STOCK_TRANSACTION_TYPES, required: true },
  quantity: { type: Number, required: true },
  unit: String,
  unitCostSnapshot: Number,
  sourceDocumentType: String,
  sourceDocumentId: { type: Schema.Types.ObjectId },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard' },
  workItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
  requisitionId: { type: Schema.Types.ObjectId, ref: 'PartsRequisition' },
  issueLineId: String,
  performedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  performedAt: { type: Date, default: Date.now },
  idempotencyKey: String,
  remarks: String,
}, { timestamps: true })
stockLedgerSchema.index({ tenantId: 1, warehouseId: 1, partId: 1, performedAt: -1 })
stockLedgerSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })

const stockIssueLineSchema = new Schema({
  partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
  requisitionLineId: String,
  quantity: { type: Number, required: true },
  quantityConsumed: { type: Number, default: 0 },
  quantityReturned: { type: Number, default: 0 },
  unitCostSnapshot: Number,
  workItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
}, { _id: true })

const stockIssueSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  issueNumber: { type: String, required: true },
  requisitionId: { type: Schema.Types.ObjectId, ref: 'PartsRequisition' },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  lines: [stockIssueLineSchema],
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  issuedAt: { type: Date, default: Date.now },
  idempotencyKey: String,
}, { timestamps: true })
stockIssueSchema.index({ tenantId: 1, issueNumber: 1 }, { unique: true })

const stockReturnSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  returnNumber: { type: String, required: true },
  stockIssueId: { type: Schema.Types.ObjectId, ref: 'StockIssue', required: true },
  issueLineId: { type: String, required: true },
  partId: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  quantity: { type: Number, required: true },
  reason: String,
  condition: { type: String, enum: ['REUSABLE', 'DAMAGED', 'SCRAPPED'], default: 'REUSABLE' },
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  returnedAt: { type: Date, default: Date.now },
  idempotencyKey: String,
}, { timestamps: true })
stockReturnSchema.index({ tenantId: 1, returnNumber: 1 }, { unique: true })

const additionalWorkRequestSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  requestNumber: { type: String, required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  jobCardRevisionNumber: { type: Number, default: 1 },
  sourceWorkItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
  discoveredBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  discoveredAt: { type: Date, default: Date.now },
  discoveryCategory: String,
  faultDescription: { type: String, required: true },
  component: String,
  technicalFinding: String,
  whyNotVisibleEarlier: String,
  safetySeverity: String,
  additionalWorkDescription: String,
  estimatedLabourHours: Number,
  requiredParts: [{ partId: { type: Schema.Types.ObjectId, ref: 'Part' }, quantity: Number, description: String }],
  evidencePhotos: [{ url: String, publicId: String }],
  customerImpact: String,
  deliveryImpact: String,
  requestPriority: String,
  technicianRemarks: String,
  supervisorRemarks: String,
  status: { type: String, enum: ADDITIONAL_WORK_STATUSES, default: 'DRAFT' },
  supplementaryEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
  blocksWorkItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
}, { timestamps: true })
additionalWorkRequestSchema.index({ tenantId: 1, requestNumber: 1 }, { unique: true })
additionalWorkRequestSchema.index({ tenantId: 1, jobCardId: 1 })

const jobCardRevisionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  revisionNumber: { type: Number, required: true },
  previousRevisionId: { type: Schema.Types.ObjectId, ref: 'JobCardRevision' },
  source: { type: String, enum: ['INITIAL', 'SUPPLEMENTARY_APPROVAL'], default: 'INITIAL' },
  supplementaryEstimateId: { type: Schema.Types.ObjectId, ref: 'Estimate' },
  supplementaryApprovalId: { type: Schema.Types.ObjectId, ref: 'CustomerApproval' },
  addedWorkItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
  revisedAuthorizedValue: Number,
  revisedPlannedLabourHours: Number,
  revisedDeliveryCommitment: Date,
  revisionReason: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  effectiveAt: { type: Date, default: Date.now },
  idempotencyKey: String,
}, { timestamps: true })
jobCardRevisionSchema.index({ tenantId: 1, jobCardId: 1, revisionNumber: 1 }, { unique: true })

const qcWorkCheckSchema = new Schema({
  jobWorkItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem', required: true },
  workDescription: String,
  assignedTeamName: String,
  mechanicName: String,
  workPerformed: String,
  qcCategory: String,
  checkpoint: String,
  expectedStandard: String,
  actualObservation: String,
  result: { type: String, enum: CHECKLIST_RESULTS, default: 'NOT_TESTED' },
  severity: String,
  inspectorRemarks: String,
  evidence: [{ url: String, publicId: String, remarks: String }],
  checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedAt: Date,
  required: { type: Boolean, default: true },
}, { _id: true })

const qcQuantityLineSchema = new Schema({
  partId: { type: Schema.Types.ObjectId, ref: 'Part' },
  partNumber: String,
  description: String,
  uom: String,
  jobWorkItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
  approvedQuantity: Number,
  requestedQuantity: Number,
  issuedQuantity: Number,
  consumedQuantity: Number,
  returnedQuantity: Number,
  scrapQuantity: Number,
  outstandingQuantity: Number,
  result: { type: String, enum: QC_QUANTITY_RESULTS, default: 'PENDING' },
  inspectorRemarks: String,
  blocking: { type: Boolean, default: false },
}, { _id: true })

const qcVocCheckSchema = new Schema({
  vocComplaintId: String,
  originalDescription: String,
  relatedWorkItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
  workPerformed: String,
  faultReproducedAfterRepair: Boolean,
  resolutionStatus: { type: String, enum: VOC_QC_RESOLUTION_STATUSES, default: 'FURTHER_VERIFICATION_REQUIRED' },
  verificationMethod: String,
  remarks: String,
  evidence: [{ url: String, publicId: String }],
}, { _id: true })

const qcRoadTestCheckSchema = new Schema({
  system: String,
  checkpoint: String,
  result: { type: String, enum: CHECKLIST_RESULTS, default: 'NOT_TESTED' },
  remarks: String,
  evidence: [{ url: String, publicId: String }],
}, { _id: true })

const qcRoadTestSchema = new Schema({
  disposition: { type: String, enum: QC_ROAD_TEST_DISPOSITIONS, default: 'PENDING' },
  exceptionReason: String,
  authorizedDriverId: { type: Schema.Types.ObjectId, ref: 'User' },
  trialDate: Date,
  startTime: Date,
  endTime: Date,
  startOdometer: Number,
  endOdometer: Number,
  routeArea: String,
  trialType: String,
  weatherConditions: String,
  roadConditions: String,
  fuelLevel: String,
  safetyPrerequisiteCheck: Boolean,
  originalComplaintVerified: Boolean,
  remarks: String,
  finalResult: { type: String, enum: CHECKLIST_RESULTS, default: 'NOT_TESTED' },
  evidence: [{ url: String, publicId: String }],
  checklist: [qcRoadTestCheckSchema],
}, { _id: false })

const qcInspectorFeedbackSchema = new Schema({
  overallRepairQuality: String,
  partsQuantitySummary: String,
  vocResolutionSummary: String,
  roadTestOutcome: String,
  vehicleOperatingCondition: String,
  unresolvedIssues: String,
  safetyCriticalIssues: String,
  minorObservations: String,
  recommendedRework: String,
  inspectorRemarks: String,
  finalDecision: { type: String, enum: QC_DECISIONS },
}, { _id: false })

const qcAttemptSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  qcCaseId: { type: Schema.Types.ObjectId, ref: 'QualityControlCase', required: true },
  attemptNumber: { type: Number, required: true },
  previousAttemptId: { type: Schema.Types.ObjectId, ref: 'QCAttempt' },
  inspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
  jobCardRevisionNumber: Number,
  status: { type: String, default: 'DRAFT' },
  startedAt: Date,
  submittedAt: Date,
  workChecks: [qcWorkCheckSchema],
  quantityLines: [qcQuantityLineSchema],
  vocChecks: [qcVocCheckSchema],
  roadTest: qcRoadTestSchema,
  inspectorFeedback: qcInspectorFeedbackSchema,
  finalDecision: { type: String, enum: QC_DECISIONS },
  locked: { type: Boolean, default: false },
  evidence: [{ category: String, url: String, publicId: String, remarks: String, checklistItemId: String }],
}, { timestamps: true })
qcAttemptSchema.index({ tenantId: 1, qcCaseId: 1, attemptNumber: 1 }, { unique: true })

const qualityControlCaseSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  qcReference: { type: String, required: true },
  jobCardRevisionNumber: { type: Number, default: 1 },
  status: { type: String, enum: QC_CASE_STATUSES, default: 'AWAITING_QC' },
  assignedInspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  assignedAt: Date,
  plannedQcTime: Date,
  priority: String,
  specialInstructions: String,
  assignmentHistory: [{
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    at: Date,
    reason: String,
  }],
  currentAttemptNumber: { type: Number, default: 0 },
  currentAttemptId: { type: Schema.Types.ObjectId, ref: 'QCAttempt' },
  workCompletionAt: Date,
  invoiceReleasedAt: Date,
  invalidatedByRevision: { type: Boolean, default: false },
}, { timestamps: true })
qualityControlCaseSchema.index({ tenantId: 1, qcReference: 1 }, { unique: true })
qualityControlCaseSchema.index({ tenantId: 1, jobCardId: 1 }, { unique: true })
qualityControlCaseSchema.index({ tenantId: 1, branchId: 1, status: 1 })

const qcReworkRequestSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  qcCaseId: { type: Schema.Types.ObjectId, ref: 'QualityControlCase', required: true },
  qcAttemptId: { type: Schema.Types.ObjectId, ref: 'QCAttempt', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  reworkNumber: { type: String, required: true },
  workItemIds: [{ type: Schema.Types.ObjectId, ref: 'JobWorkItem' }],
  defectDescription: String,
  failedCheckIds: [String],
  assignedTeamId: { type: Schema.Types.ObjectId, ref: 'WorkshopTeam' },
  assignedSupervisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: QC_REWORK_STATUSES, default: 'OPEN' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  completedAt: Date,
}, { timestamps: true })
qcReworkRequestSchema.index({ tenantId: 1, reworkNumber: 1 }, { unique: true })

const invoiceLineSchema = new Schema({
  sourceEstimateLineId: String,
  supplementaryEstimateLineId: String,
  sourceJobWorkItemId: { type: Schema.Types.ObjectId, ref: 'JobWorkItem' },
  sourcePartsRef: String,
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard' },
  jobCardRevision: Number,
  stockPartId: { type: Schema.Types.ObjectId, ref: 'Part' },
  category: String,
  itemCode: String,
  partNumber: String,
  description: { type: String, required: true },
  hsnSac: String,
  quantity: { type: Number, default: 1 },
  approvedQuantity: Number,
  requestedQuantity: Number,
  issuedQuantity: Number,
  consumedQuantity: Number,
  returnedQuantity: Number,
  scrappedQuantity: Number,
  outstandingQuantity: Number,
  billableQuantity: Number,
  approvedUnitSellingPrice: Number,
  uom: String,
  unitRate: { type: Number, default: 0 },
  grossAmount: Number,
  discountAmount: Number,
  taxableAmount: Number,
  cgstAmount: Number,
  sgstAmount: Number,
  igstAmount: Number,
  finalAmount: Number,
  taxRuleId: String,
  reconciliationStatus: { type: String, enum: ['OK', 'VARIANCE', 'BLOCKING'], default: 'OK' },
  varianceReason: String,
  lineStatus: { type: String, default: 'ACTIVE' },
  remarks: String,
}, { _id: true })

const invoiceReconciliationLineSchema = new Schema({
  partId: String,
  partNumber: String,
  partName: String,
  jobCardId: String,
  jobCardRevision: Number,
  approvedEstimateLineId: String,
  supplementaryEstimateLineId: String,
  approvedQuantity: Number,
  requestedQuantity: Number,
  issuedQuantity: Number,
  consumedQuantity: Number,
  returnedQuantity: Number,
  scrappedQuantity: Number,
  outstandingQuantity: Number,
  billableQuantity: Number,
  approvedUnitSellingPrice: Number,
  reconciliationStatus: String,
  varianceReason: String,
  authorizedException: Boolean,
}, { _id: false })

const finalInvoiceSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  jobCardId: { type: Schema.Types.ObjectId, ref: 'JobCard', required: true },
  qcCaseId: { type: Schema.Types.ObjectId, ref: 'QualityControlCase' },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  invoiceNumber: { type: String, required: true },
  financialYear: String,
  invoiceType: { type: String, default: 'TAX_INVOICE' },
  status: { type: String, enum: FINAL_INVOICE_STATUSES, default: 'DRAFT' },
  paymentStatus: { type: String, enum: INVOICE_PAYMENT_STATUSES, default: 'UNPAID' },
  jobCardRevisionNumber: Number,
  qcReference: String,
  customerSnapshot: Schema.Types.Mixed,
  vehicleSnapshot: Schema.Types.Mixed,
  supplierSnapshot: Schema.Types.Mixed,
  placeOfSupply: String,
  lines: [invoiceLineSchema],
  reconciliationLines: [invoiceReconciliationLineSchema],
  reconciliationBlocking: { type: Boolean, default: false },
  reconciliationOverrides: Schema.Types.Mixed,
  taxSummary: {
    labourSubtotal: Number,
    partsSubtotal: Number,
    grossValue: Number,
    discountTotal: Number,
    taxableValue: Number,
    cgstTotal: Number,
    sgstTotal: Number,
    igstTotal: Number,
    roundingAdjustment: Number,
    grandTotal: Number,
  },
  grandTotal: { type: Number, default: 0 },
  advanceAllocated: { type: Number, default: 0 },
  paymentsReceived: { type: Number, default: 0 },
  balanceDue: { type: Number, default: 0 },
  creditsApplied: { type: Number, default: 0 },
  creditClearanceAuthorized: { type: Boolean, default: false },
  eInvoice: {
    eligibility: { type: String, default: 'PENDING_ASSESSMENT' },
    irnStatus: { type: String, enum: EINVOICE_IRN_STATUSES, default: 'NOT_APPLICABLE' },
    irn: String,
    ackNo: String,
    ackDate: Date,
    signedQrCode: String,
    providerReference: String,
    providerRequestId: String,
    lastError: String,
    cancelledAt: Date,
    cancelReason: String,
  },
  creditClearanceBy: { type: Schema.Types.ObjectId, ref: 'User' },
  creditClearanceAt: Date,
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: String,
  issuedSnapshotHash: String,
}, { timestamps: true })
finalInvoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true })
finalInvoiceSchema.index({ tenantId: 1, serviceVisitId: 1, status: 1 })

const invoiceAllocationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  sourcePaymentId: { type: Schema.Types.ObjectId, ref: 'AdvancePayment' },
  invoicePaymentId: { type: Schema.Types.ObjectId, ref: 'InvoicePayment' },
  sourceCreditNoteId: { type: Schema.Types.ObjectId, ref: 'CreditNote' },
  amount: { type: Number, required: true },
  allocationType: { type: String, enum: ['ADVANCE', 'PAYMENT', 'CREDIT_NOTE'], default: 'ADVANCE' },
  allocatedAt: { type: Date, default: Date.now },
  allocatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: String,
}, { timestamps: true })
invoiceAllocationSchema.index({ tenantId: 1, invoiceId: 1, sourcePaymentId: 1 }, { unique: true, sparse: true })
invoiceAllocationSchema.index({ tenantId: 1, invoiceId: 1, sourceCreditNoteId: 1 }, { unique: true, sparse: true })
invoiceAllocationSchema.index({ tenantId: 1, invoiceId: 1, invoicePaymentId: 1 }, { unique: true, sparse: true })
invoiceAllocationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })

const creditNoteLineSchema = new Schema({
  description: String,
  hsnSac: String,
  quantity: Number,
  unitPrice: Number,
  taxableValue: Number,
  cgst: Number,
  sgst: Number,
  igst: Number,
  lineTotal: Number,
  originalInvoiceLineId: String,
}, { _id: false })

const creditNoteSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit' },
  creditNoteNumber: { type: String, required: true },
  financialYear: String,
  status: { type: String, enum: CREDIT_NOTE_STATUSES, default: 'DRAFT' },
  reason: String,
  lines: [creditNoteLineSchema],
  grandTotal: { type: Number, default: 0 },
  taxSummary: Schema.Types.Mixed,
  amountApplied: { type: Number, default: 0 },
  amountRemaining: { type: Number, default: 0 },
  issuedAt: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancelReason: String,
  reversedAt: Date,
  reverseReason: String,
  idempotencyKey: String,
  eInvoice: {
    irnStatus: { type: String, enum: EINVOICE_IRN_STATUSES, default: 'NOT_APPLICABLE' },
    irn: String,
    ackNo: String,
    ackDate: Date,
    signedQrCode: String,
    providerReference: String,
    lastError: String,
  },
}, { timestamps: true })
creditNoteSchema.index({ tenantId: 1, creditNoteNumber: 1 }, { unique: true })
creditNoteSchema.index({ tenantId: 1, customerId: 1, status: 1 })
creditNoteSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })

const paymentRequestSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  invoiceNumber: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  currency: { type: String, default: 'INR' },
  requestedAmount: { type: Number, required: true },
  amountPaid: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },
  razorpayPaymentLinkId: String,
  razorpayReferenceId: { type: String, required: true },
  razorpayShortUrl: String,
  providerStatus: { type: String, default: 'created' },
  reconciliationStatus: {
    type: String,
    enum: ['PENDING', 'PARTIALLY_RECONCILED', 'RECONCILED', 'EXPIRED', 'CANCELLED', 'FAILED'],
    default: 'PENDING',
  },
  expiresAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  supersededBy: { type: Schema.Types.ObjectId, ref: 'PaymentRequest' },
  sharingHistory: [{
    channel: { type: String, enum: ['EMAIL', 'WHATSAPP', 'MANUAL'] },
    recipient: String,
    status: String,
    providerReference: String,
    errorDetails: String,
    sentAt: Date,
  }],
  razorpayPaymentIds: [String],
  lastVerifiedAt: Date,
  idempotencyKey: String,
}, { timestamps: true })
paymentRequestSchema.index({ tenantId: 1, invoiceId: 1, reconciliationStatus: 1 })
paymentRequestSchema.index({ tenantId: 1, razorpayReferenceId: 1 }, { unique: true })
paymentRequestSchema.index({ tenantId: 1, razorpayPaymentLinkId: 1 }, { unique: true, sparse: true })
paymentRequestSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })

const razorpayWebhookEventSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  providerEventId: { type: String, required: true, unique: true },
  eventType: String,
  payload: Schema.Types.Mixed,
  processedAt: Date,
  processingStatus: { type: String, enum: ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'], default: 'RECEIVED' },
  errorDetails: String,
}, { timestamps: true })

const invoicePaymentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  receiptNumber: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  paymentMethod: { type: String, required: true },
  transactionReference: String,
  verificationStatus: { type: String, default: 'PENDING_VERIFICATION' },
  collectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  receivedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  remarks: String,
  idempotencyKey: String,
}, { timestamps: true })
invoicePaymentSchema.index({ tenantId: 1, receiptNumber: 1 }, { unique: true })
invoicePaymentSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })
invoicePaymentSchema.index({ tenantId: 1, transactionReference: 1 }, { unique: true, sparse: true })

const invoiceCommunicationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  channel: { type: String, enum: ['EMAIL', 'WHATSAPP', 'MANUAL'] },
  recipient: String,
  status: { type: String, default: 'PENDING' },
  providerReference: String,
  errorDetails: String,
}, { timestamps: true })

const invoiceAcknowledgmentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  acknowledgmentType: String,
  verifiedContact: String,
  verificationMethod: String,
  acknowledgedAt: { type: Date, default: Date.now },
  remarks: String,
}, { timestamps: true })

const gatePassSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice', required: true },
  gatePassNumber: { type: String, required: true },
  vehicleRegistration: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  qcReference: String,
  paymentClearanceRef: String,
  authorizedReceiver: String,
  receiverMobile: String,
  status: { type: String, enum: GATE_PASS_STATUSES, default: 'DRAFT' },
  issueDate: Date,
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  authorizedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  validUntil: Date,
  verificationToken: String,
  remarks: String,
  idempotencyKey: String,
}, { timestamps: true })
gatePassSchema.index({ tenantId: 1, gatePassNumber: 1 }, { unique: true })
gatePassSchema.index({ tenantId: 1, serviceVisitId: 1, status: 1 })

const vehicleDeliverySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  gatePassId: { type: Schema.Types.ObjectId, ref: 'GatePass', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice' },
  vehicleRegistration: String,
  receiverName: String,
  receiverMobile: String,
  receiverVerificationMethod: String,
  finalOdometer: Number,
  finalFuelLevel: String,
  keysReturned: { type: Boolean, default: true },
  deliveryChecklist: Schema.Types.Mixed,
  customerAcknowledged: { type: Boolean, default: false },
  deliveryPhotos: [{ url: String, publicId: String }],
  deliveryRemarks: String,
  status: { type: String, enum: DELIVERY_STATUSES, default: 'PENDING' },
  deliveredAt: Date,
  deliveredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: String,
}, { timestamps: true })
vehicleDeliverySchema.index({ tenantId: 1, serviceVisitId: 1 }, { unique: true })

const customerFeedbackSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'FinalInvoice' },
  deliveryId: { type: Schema.Types.ObjectId, ref: 'VehicleDelivery' },
  overallRating: { type: Number, min: 1, max: 5 },
  serviceQuality: Number,
  repairSatisfaction: Number,
  timeliness: Number,
  staffBehaviour: Number,
  billingTransparency: Number,
  wouldRecommend: Boolean,
  customerRemarks: String,
  additionalComplaint: String,
  feedbackSource: String,
  followUpRequired: { type: Boolean, default: false },
  followUpStatus: { type: String, default: 'OPEN' },
}, { timestamps: true })
customerFeedbackSchema.index({ tenantId: 1, serviceVisitId: 1 }, { unique: true })

// ─── System ──────────────────────────────────────────────────────

const numberingSeriesSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  module: { type: String, required: true },
  prefix: { type: String, required: true },
  suffix: String,
  currentNo: { type: Number, default: 0 },
  padLength: { type: Number, default: 6 },
  includeYearMonth: { type: Boolean, default: true },
})
numberingSeriesSchema.index({ tenantId: 1, module: 1 }, { unique: true })

const auditLogSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant' },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  module: { type: String, required: true },
  recordId: String,
  action: { type: String, required: true },
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  ipAddress: String,
  userAgent: String,
}, { timestamps: { createdAt: true, updatedAt: false } })
auditLogSchema.index({ tenantId: 1, module: 1, createdAt: -1 })

const mediaSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch' },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  resourceType: { type: String, default: 'image' },
  imageCategory: { type: String, enum: IMAGE_CATEGORIES },
  format: String,
  bytes: Number,
  width: Number,
  height: Number,
  folder: String,
  tags: [String],
  entityType: String,
  entityId: String,
  remarks: String,
}, { timestamps: true })
mediaSchema.index({ tenantId: 1, entityType: 1, entityId: 1 })

// ─── Master Data (dropdowns) ─────────────────────────────────────

const masterDataSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  category: { type: String, required: true },
  code: { type: String, required: true },
  label: { type: String, required: true },
  parentCode: String,
  sortOrder: { type: Number, default: 0 },
  metadata: Schema.Types.Mixed,
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
masterDataSchema.index({ tenantId: 1, category: 1, code: 1 }, { unique: true })
masterDataSchema.index({ tenantId: 1, category: 1, isActive: 1 })

// Branch is a separate collection linked to tenant
const branchModelSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  code: { type: String, required: true },
  name: { type: String, required: true },
  address: String,
  city: String,
  state: String,
  pin: String,
  phone: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true })
branchModelSchema.index({ tenantId: 1, code: 1 }, { unique: true })

export const Tenant = model('Tenant', tenantSchema)
export const Branch = model('Branch', branchModelSchema)
export const Permission = model('Permission', permissionSchema)
export const Role = model('Role', roleSchema)
export const User = model('User', userSchema)
export const RefreshToken = model('RefreshToken', refreshTokenSchema)
export const Customer = model('Customer', customerSchema)
export const Vehicle = model('Vehicle', vehicleSchema)
export const Booking = model('Booking', bookingSchema)
export const ServiceVisit = model('ServiceVisit', serviceVisitSchema)
export const JobCard = model('JobCard', jobCardSchema)
export const JobWorkItem = model('JobWorkItem', jobWorkItemSchema)
export const WorkshopTeam = model('WorkshopTeam', workshopTeamSchema)
export const WorkAssignment = model('WorkAssignment', workAssignmentSchema)
export const WorkshopLocation = model('WorkshopLocation', workshopLocationSchema)
export const LocationReservation = model('LocationReservation', locationReservationSchema)
export const Bay = model('Bay', baySchema)
export const Part = model('Part', partSchema)
export const Warehouse = model('Warehouse', warehouseSchema)
export const StockBalance = model('StockBalance', stockBalanceSchema)
export const WipRecord = model('WipRecord', wipRecordSchema)
export const WorkSession = model('WorkSession', workSessionSchema)
export const PartsRequisition = model('PartsRequisition', partsRequisitionSchema)
export const StockLedger = model('StockLedger', stockLedgerSchema)
export const StockIssue = model('StockIssue', stockIssueSchema)
export const StockReturn = model('StockReturn', stockReturnSchema)
export const AdditionalWorkRequest = model('AdditionalWorkRequest', additionalWorkRequestSchema)
export const JobCardRevision = model('JobCardRevision', jobCardRevisionSchema)
export const QualityControlCase = model('QualityControlCase', qualityControlCaseSchema)
export const QCAttempt = model('QCAttempt', qcAttemptSchema)
export const QCReworkRequest = model('QCReworkRequest', qcReworkRequestSchema)
export const FinalInvoice = model('FinalInvoice', finalInvoiceSchema)
export const InvoiceAllocation = model('InvoiceAllocation', invoiceAllocationSchema)
export const CreditNote = model('CreditNote', creditNoteSchema)
export const PaymentRequest = model('PaymentRequest', paymentRequestSchema)
export const RazorpayWebhookEvent = model('RazorpayWebhookEvent', razorpayWebhookEventSchema)
export const InvoicePayment = model('InvoicePayment', invoicePaymentSchema)
export const InvoiceCommunication = model('InvoiceCommunication', invoiceCommunicationSchema)
export const InvoiceAcknowledgment = model('InvoiceAcknowledgment', invoiceAcknowledgmentSchema)
export const GatePass = model('GatePass', gatePassSchema)
export const VehicleDelivery = model('VehicleDelivery', vehicleDeliverySchema)
export const CustomerFeedback = model('CustomerFeedback', customerFeedbackSchema)
export const NumberingSeries = model('NumberingSeries', numberingSeriesSchema)
export const AuditLog = model('AuditLog', auditLogSchema)
export const Media = model('Media', mediaSchema)
export const MasterData = model('MasterData', masterDataSchema)
export const PickupTask = model('PickupTask', pickupTaskSchema)
export const ReceivingRecord = model('ReceivingRecord', receivingRecordSchema)
export const VocRecord = model('VocRecord', vocRecordSchema)
export const InspectionCase = model('InspectionCase', inspectionCaseSchema)
export const TaxRule = model('TaxRule', taxRuleSchema)
export const DiscountPolicy = model('DiscountPolicy', discountPolicySchema)
export const Estimate = model('Estimate', estimateSchema)
export const EstimateCommunication = model('EstimateCommunication', estimateCommunicationSchema)
export const CustomerCreditProfile = model('CustomerCreditProfile', customerCreditProfileSchema)
export const PaymentPolicy = model('PaymentPolicy', paymentPolicySchema)
export const CustomerApproval = model('CustomerApproval', customerApprovalSchema)
export const AdvancePayment = model('AdvancePayment', advancePaymentSchema)
export const Receipt = model('Receipt', receiptSchema)
export const ReceiptCommunication = model('ReceiptCommunication', receiptCommunicationSchema)
export const FinancialAuthorization = model('FinancialAuthorization', financialAuthorizationSchema)

export type BranchDoc = typeof Branch.prototype & { _id: Types.ObjectId }
