import { Booking, MasterData, Media, PickupTask, ReceivingRecord, ServiceVisit, Vehicle, VocRecord } from '../../models/index.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'
import { assertBookingStatusTransition } from '../bookings/booking-transitions.js'
import { normalizeBookingStatus } from '../../types/enums.js'
import type { Request } from 'express'
import { receivingDraftSchema } from './receiving.validation.js'
import { ensureVocFromBooking } from '../voc/voc.service.js'

const INVENTORY_CATEGORIES = [
  'INVENTORY_DOCUMENT',
  'INVENTORY_KEY',
  'INVENTORY_TOOL',
  'INVENTORY_ACCESSORY',
]

export async function getReceivingQueue(req: Request) {
  const tenantId = req.tenantId!
  const branchId = req.branchId

  const bookings = await Booking.find({
    tenantId,
    ...(branchId && { branchId }),
    status: { $in: ['AWAITING_GATE_IN', 'PICKUP_IN_PROGRESS', 'CONFIRMED', 'ARRIVED'] },
  })
    .populate('customerId', 'name mobile')
    .populate('vehicleId', 'registrationNo make model')
    .sort({ bookingDate: -1 })
    .limit(50)
    .lean()

  const visits = await ServiceVisit.find({
    tenantId,
    ...(branchId && { branchId }),
    currentStage: { $in: ['ARRIVAL', 'INVENTORY', 'VOC'] },
    status: { $in: ['OPEN', 'IN_PROGRESS'] },
  })
    .populate('customerId', 'name mobile')
    .populate('vehicleId', 'registrationNo make model')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean()

  const receiving = await ReceivingRecord.find({
    tenantId,
    ...(branchId && { branchId }),
    receivingStatus: { $in: ['DRAFT', 'IN_PROGRESS', 'EXCEPTION'] },
  })
    .populate('visitId', 'visitNumber currentStage')
    .limit(50)
    .lean()

  return {
    expectedArrivals: bookings.map((b) => ({
      id: b._id.toString(),
      kind: 'booking',
      reference: b.bookingNumber,
      status: normalizeBookingStatus(b.status),
      customer: b.customerId,
      vehicle: b.vehicleId,
      bookingType: b.bookingType,
    })),
    activeVisits: visits.map((v) => ({
      id: v._id.toString(),
      visitNumber: v.visitNumber,
      currentStage: v.currentStage,
      customer: v.customerId,
      vehicle: v.vehicleId,
    })),
    receivingInProgress: receiving.map((r) => ({
      id: r._id.toString(),
      visitId: r.visitId?.toString(),
      status: r.receivingStatus,
    })),
  }
}

async function defaultInventorySnapshot(tenantId: string) {
  const masters = await MasterData.find({
    tenantId,
    category: { $in: INVENTORY_CATEGORIES },
    isActive: true,
  }).sort({ sortOrder: 1 }).lean()

  return masters.map((m) => ({
    masterItemId: m._id.toString(),
    category: m.category,
    code: m.code,
    label: m.label,
    status: 'NOT_CHECKED',
  }))
}

function resolveDocId(ref: unknown): string | null {
  if (!ref) return null
  if (typeof ref === 'object' && ref !== null && '_id' in ref) {
    return String((ref as { _id: unknown })._id)
  }
  return String(ref)
}

export async function getReceivingByVisit(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! })
    .populate('customerId')
    .populate('vehicleId')
    .populate('bookingId')
    .lean()
  if (!visit) throw new NotFoundError('Service visit not found')

  let record = await ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId }).lean()
  if (!record) {
    const snapshot = await defaultInventorySnapshot(req.tenantId!)
    const created = await ReceivingRecord.create({
      tenantId: req.tenantId!,
      branchId: visit.branchId,
      bookingId: visit.bookingId,
      visitId,
      receivingStatus: 'DRAFT',
      inventoryItems: snapshot,
    })
    record = created.toObject()
  }

  return { visit, receiving: { ...record, id: record._id.toString() } }
}

export async function getReceivingWorkspace(req: Request, visitId: string) {
  const base = await getReceivingByVisit(req, visitId)
  const bookingId = resolveDocId(base.visit.bookingId)
  const booking = bookingId
    ? await Booking.findOne({ _id: bookingId, tenantId: req.tenantId! }).lean()
    : null
  const pickup = booking
    ? await PickupTask.findOne({ tenantId: req.tenantId!, bookingId: booking._id }).lean()
    : null
  await ensureVocFromBooking(req, visitId, booking as Parameters<typeof ensureVocFromBooking>[2])
  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId }).lean()
  const media = await Media.find({
    tenantId: req.tenantId!,
    entityType: 'service_visit',
    entityId: visitId,
  }).sort({ createdAt: -1 }).limit(50).lean()

  return {
    ...base,
    booking,
    pickup,
    voc: voc ? { ...voc, id: voc._id.toString() } : null,
    media: media.map((m) => ({ ...m, id: m._id.toString() })),
  }
}

function validateGateInRequired(record: {
  odometer?: number | null
  fuelLevel?: string | null
  keyCount?: number | null
  observedEngineNo?: string | null
  observedChassisNo?: string | null
  engineMatchStatus?: string | null
  chassisMatchStatus?: string | null
}) {
  const missing: string[] = []
  if (record.odometer == null) missing.push('odometer')
  if (!record.fuelLevel) missing.push('fuelLevel')
  if (record.keyCount == null) missing.push('keyCount')
  if (!record.observedEngineNo) missing.push('observedEngineNo')
  if (!record.observedChassisNo) missing.push('observedChassisNo')
  if (!record.engineMatchStatus || record.engineMatchStatus === 'NOT_CHECKED') missing.push('engineMatchStatus')
  if (!record.chassisMatchStatus || record.chassisMatchStatus === 'NOT_CHECKED') missing.push('chassisMatchStatus')
  if (missing.length) {
    throw new ValidationError(`Gate-in required fields missing: ${missing.join(', ')}`)
  }
}

export async function saveReceivingDraft(req: Request, visitId: string, payload: Record<string, unknown>) {
  const parsed = receivingDraftSchema.parse(payload)
  const record = await ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!record) throw new NotFoundError('Receiving record not found')
  if (record.receivingStatus === 'COMPLETED') {
    throw new ConflictError('Completed receiving cannot be edited')
  }

  if (parsed.observedArrivalAt) {
    record.observedArrivalAt = new Date(parsed.observedArrivalAt as string)
  }
  if (parsed.odometer !== undefined) record.odometer = parsed.odometer
  if (parsed.odometerUnit) record.odometerUnit = parsed.odometerUnit
  if (parsed.fuelLevel !== undefined) record.fuelLevel = parsed.fuelLevel
  if (parsed.observedEngineNo !== undefined) record.observedEngineNo = parsed.observedEngineNo
  if (parsed.observedChassisNo !== undefined) record.observedChassisNo = parsed.observedChassisNo
  if (parsed.engineMatchStatus) record.engineMatchStatus = parsed.engineMatchStatus
  if (parsed.chassisMatchStatus) record.chassisMatchStatus = parsed.chassisMatchStatus
  if (parsed.verificationRemarks !== undefined) record.verificationRemarks = parsed.verificationRemarks
  if (parsed.keyReceived !== undefined) record.keyReceived = parsed.keyReceived
  if (parsed.keyCount !== undefined) record.keyCount = parsed.keyCount
  if (parsed.handoverPersonName !== undefined) record.handoverPersonName = parsed.handoverPersonName
  if (parsed.vehicleConditionRemarks !== undefined) record.vehicleConditionRemarks = parsed.vehicleConditionRemarks
  if (parsed.receivingRemarks !== undefined) record.receivingRemarks = parsed.receivingRemarks
  if (parsed.inventoryItems) {
    record.inventoryItems = parsed.inventoryItems as unknown as typeof record.inventoryItems
  }
  if (parsed.exceptionFlags) record.exceptionFlags = parsed.exceptionFlags
  if (parsed.customerAcknowledged !== undefined) record.customerAcknowledged = parsed.customerAcknowledged

  if (req.user?.id && !record.receivedBy) {
    record.receivedBy = req.user.id as unknown as typeof record.receivedBy
  }

  const visit = await ServiceVisit.findOne({ _id: visitId, tenantId: req.tenantId! }).lean()
  if (parsed.odometer !== undefined && visit?.vehicleId) {
    const vehicle = await Vehicle.findOne({ _id: visit.vehicleId, tenantId: req.tenantId! }).lean()
    if (vehicle?.odometer != null && parsed.odometer < vehicle.odometer) {
      record.exceptionFlags = [...new Set([...(record.exceptionFlags ?? []), 'ODOMETER_ROLLBACK'])]
    }
  }

  record.receivingStatus = 'IN_PROGRESS'
  record.recordedAt = new Date()
  await record.save()
  return { id: record._id.toString(), receivingStatus: record.receivingStatus }
}

export async function completeReceiving(req: Request, visitId: string) {
  const record = await ReceivingRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!record) throw new NotFoundError('Receiving record not found')

  if (record.receivingStatus === 'COMPLETED' || record.receivingStatus === 'EXCEPTION') {
    return {
      id: record._id.toString(),
      receivingStatus: record.receivingStatus,
      alreadyCompleted: true,
    }
  }

  validateGateInRequired(record)

  const unchecked = (record.inventoryItems ?? []).filter((i) => i.status === 'NOT_CHECKED')
  if (unchecked.length) {
    throw new ValidationError('Complete all inventory checklist items before finishing receiving')
  }

  const voc = await VocRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!voc || voc.confirmationStatus !== 'CONFIRMED') {
    throw new ValidationError('Confirm VOC before completing receiving')
  }

  if (record.engineMatchStatus === 'MISMATCH' || record.chassisMatchStatus === 'MISMATCH') {
    record.exceptionFlags = [...new Set([...(record.exceptionFlags ?? []), 'IDENTITY_MISMATCH'])]
    record.receivingStatus = 'EXCEPTION'
  } else {
    record.receivingStatus = 'COMPLETED'
  }

  record.completedAt = new Date()
  record.completedBy = req.user?.id as unknown as typeof record.completedBy
  await record.save()

  const booking = record.bookingId
    ? await Booking.findOne({ _id: record.bookingId, tenantId: req.tenantId! })
    : null
  if (booking && normalizeBookingStatus(booking.status) === 'AWAITING_GATE_IN') {
    assertBookingStatusTransition('AWAITING_GATE_IN', 'CHECKED_IN')
    booking.status = 'CHECKED_IN'
    booking.completedGateInAt = new Date()
    await booking.save()
  }

  if (record.receivingStatus === 'COMPLETED') {
    await ServiceVisit.updateOne(
      { _id: visitId, tenantId: req.tenantId! },
      { currentStage: 'INSPECTION' },
    )
    try {
      const { syncEligibleInspectionCases } = await import('../inspections/inspections.service.js')
      await syncEligibleInspectionCases(req)
    } catch {
      // inspection module optional during partial deploy
    }
  }

  return {
    id: record._id.toString(),
    receivingStatus: record.receivingStatus,
    alreadyCompleted: false,
  }
}
