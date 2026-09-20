import { Schema, model, type Types } from 'mongoose'
import {
  BOOKING_STATUSES,
  CUSTOMER_TYPES,
  JOB_CARD_STATUSES,
  SERVICE_STAGES,
  SERVICE_VISIT_STATUSES,
  STAGE_STATUSES,
  TENANT_STATUSES,
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
  imageUrl: String,
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
  stageLogs: [stageLogSchema],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
serviceVisitSchema.index({ tenantId: 1, visitNumber: 1 }, { unique: true })

const bookingSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  bookingNumber: { type: String, required: true },
  bookingDate: { type: Date, required: true },
  source: String,
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  serviceType: String,
  customerComplaint: String,
  preferredDate: Date,
  preferredSlot: String,
  pickupRequired: { type: Boolean, default: false },
  pickupAddress: String,
  advisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  expectedArrival: Date,
  remarks: String,
  status: { type: String, enum: BOOKING_STATUSES, default: 'BOOKED' },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
bookingSchema.index({ tenantId: 1, bookingNumber: 1 }, { unique: true })

const jobCardSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true },
  branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  serviceVisitId: { type: Schema.Types.ObjectId, ref: 'ServiceVisit', required: true },
  jobCardNumber: { type: String, required: true },
  jobType: String,
  promiseDate: Date,
  advisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  supervisorId: { type: Schema.Types.ObjectId, ref: 'User' },
  bayId: { type: Schema.Types.ObjectId, ref: 'Bay' },
  priority: String,
  approvedValue: Number,
  currentValue: Number,
  status: { type: String, enum: JOB_CARD_STATUSES, default: 'OPEN' },
  holdReason: String,
  instructions: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true })
jobCardSchema.index({ tenantId: 1, jobCardNumber: 1 }, { unique: true })

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
  available: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  reorderLevel: { type: Number, default: 0 },
}, { timestamps: { createdAt: false, updatedAt: true } })
stockBalanceSchema.index({ partId: 1, warehouseId: 1 }, { unique: true })

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
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  resourceType: { type: String, default: 'image' },
  format: String,
  bytes: Number,
  width: Number,
  height: Number,
  folder: String,
  tags: [String],
  entityType: String,
  entityId: String,
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
export const Bay = model('Bay', baySchema)
export const Part = model('Part', partSchema)
export const Warehouse = model('Warehouse', warehouseSchema)
export const StockBalance = model('StockBalance', stockBalanceSchema)
export const NumberingSeries = model('NumberingSeries', numberingSeriesSchema)
export const AuditLog = model('AuditLog', auditLogSchema)
export const Media = model('Media', mediaSchema)
export const MasterData = model('MasterData', masterDataSchema)

export type BranchDoc = typeof Branch.prototype & { _id: Types.ObjectId }
