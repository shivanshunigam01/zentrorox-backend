import { Booking, PickupTask, ServiceVisit, Vehicle } from '../../models/index.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import type { Request } from 'express'
import type { ArrivalMethod, BookingStatus, BookingType } from '../../types/enums.js'
import { normalizeBookingStatus } from '../../types/enums.js'
import { assertBookingStatusTransition } from './booking-transitions.js'

async function syncVehicleDetails(
  req: Request,
  vehicleId: string,
  data: {
    engineNo?: string
    chassisNo?: string
    vehicleImageUrl?: string
    vehicleImagePublicId?: string
  },
) {
  if (
    data.engineNo === undefined &&
    data.chassisNo === undefined &&
    data.vehicleImageUrl === undefined &&
    data.vehicleImagePublicId === undefined
  ) {
    return
  }

  const vehicle = await Vehicle.findOne({ _id: vehicleId, tenantId: req.tenantId! })
  if (!vehicle) return

  if (data.engineNo !== undefined && !vehicle.engineNo) vehicle.engineNo = data.engineNo
  if (data.chassisNo !== undefined && !vehicle.chassisNo) {
    vehicle.chassisNo = data.chassisNo
    if (!vehicle.vin) vehicle.vin = data.chassisNo
  }
  if (data.vehicleImageUrl !== undefined) vehicle.imageUrl = data.vehicleImageUrl
  if (data.vehicleImagePublicId !== undefined) vehicle.imagePublicId = data.vehicleImagePublicId
  vehicle.updatedBy = req.user?.id as unknown as typeof vehicle.updatedBy
  await vehicle.save()
}

interface ListParams {
  search?: string
  status?: BookingStatus
  date?: string
  advisorId?: string
  page?: number
  limit?: number
}

export async function listBookings(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = {
    tenantId,
    ...(branchId && { branchId }),
    ...(params.status && { status: params.status }),
    ...(params.advisorId && { advisorId: params.advisorId }),
  }

  if (params.date) {
    filter.bookingDate = {
      $gte: new Date(`${params.date}T00:00:00`),
      $lte: new Date(`${params.date}T23:59:59`),
    }
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [{ bookingNumber: regex }]
  }

  const [items, total] = await Promise.all([
    Booking.find(filter)
      .populate('customerId', 'id name mobile')
      .populate('vehicleId', 'id registrationNo make model')
      .populate('branchId', 'name code')
      .sort({ bookingDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ])

  return {
    items: items.map((b) => ({
      ...b,
      id: b._id.toString(),
      customer: b.customerId,
      vehicle: b.vehicleId,
      branch: b.branchId,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getBooking(req: Request, id: string) {
  const booking = await Booking.findOne({ _id: id, tenantId: req.tenantId! })
    .populate('customerId')
    .populate('vehicleId')
    .populate('branchId')
    .lean()

  if (!booking) throw new NotFoundError('Booking not found')

  const serviceVisit = booking.serviceVisitId
    ? await ServiceVisit.findById(booking.serviceVisitId).lean()
    : null

  const customer = booking.customerId as {
    _id?: { toString(): string }
    name?: string
    mobile?: string
    email?: string
    address?: string
    city?: string
    state?: string
    pin?: string
    gstin?: string
  } | null
  const vehicle = booking.vehicleId as {
    _id?: { toString(): string }
    registrationNo?: string
    make?: string
    model?: string
    variant?: string
    vin?: string
    chassisNo?: string
    engineNo?: string
    fuelType?: string
    odometer?: number
    imageUrl?: string
    imagePublicId?: string
  } | null
  const branch = booking.branchId as {
    name?: string
    code?: string
    address?: string
    city?: string
    state?: string
    pin?: string
    phone?: string
  } | null

  return {
    id: booking._id.toString(),
    bookingNumber: booking.bookingNumber,
    bookingDate: booking.bookingDate,
    status: normalizeBookingStatus(booking.status),
    bookingType: booking.bookingType,
    arrivalMethod: booking.arrivalMethod,
    bookingCharge: booking.bookingCharge,
    customerPriority: booking.customerPriority,
    breakdownDetails: booking.breakdownDetails,
    completedGateInAt: booking.completedGateInAt,
    serviceType: booking.serviceType,
    customerComplaint: booking.customerComplaint,
    preferredSlot: booking.preferredSlot,
    preferredDate: booking.preferredDate,
    pickupRequired: booking.pickupRequired,
    pickupAddress: booking.pickupAddress,
    pickupLocationLat: booking.pickupLocationLat,
    pickupLocationLng: booking.pickupLocationLng,
    source: booking.source,
    remarks: booking.remarks,
    customer: customer
      ? {
          id: customer._id?.toString(),
          name: customer.name,
          mobile: customer.mobile,
          email: customer.email,
          address: customer.address,
          city: customer.city,
          state: customer.state,
          pin: customer.pin,
          gstin: customer.gstin,
        }
      : null,
    vehicle: vehicle
      ? {
          id: vehicle._id?.toString(),
          registrationNo: vehicle.registrationNo,
          make: vehicle.make,
          model: vehicle.model,
          variant: vehicle.variant,
          vin: vehicle.vin,
          chassisNo: vehicle.chassisNo ?? vehicle.vin,
          engineNo: vehicle.engineNo,
          fuelType: vehicle.fuelType,
          odometer: vehicle.odometer,
          imageUrl: vehicle.imageUrl,
          imagePublicId: vehicle.imagePublicId,
        }
      : null,
    branch: branch
      ? {
          name: branch.name,
          code: branch.code,
          address: branch.address,
          city: branch.city,
          state: branch.state,
          pin: branch.pin,
          phone: branch.phone,
        }
      : null,
    serviceVisit: serviceVisit
      ? { id: serviceVisit._id.toString(), visitNumber: serviceVisit.visitNumber }
      : null,
  }
}

async function assertNoOpenVisitForVehicle(tenantId: string, vehicleId: string) {
  const open = await ServiceVisit.findOne({
    tenantId,
    vehicleId,
    status: { $in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
  }).lean()
  if (open) {
    throw new ConflictError('An active service visit already exists for this vehicle')
  }
}

export async function createBooking(req: Request, data: {
  branchId: string
  customerId: string
  vehicleId: string
  bookingType?: BookingType
  arrivalMethod?: ArrivalMethod
  serviceType?: string
  customerComplaint?: string
  customerPriority?: string
  preferredDate?: string
  preferredSlot?: string
  pickupRequired?: boolean
  pickupAddress?: string
  pickupLocationLat?: number
  pickupLocationLng?: number
  source?: string
  remarks?: string
  breakdownDetails?: Record<string, unknown>
  engineNo?: string
  chassisNo?: string
  vehicleImageUrl?: string
  vehicleImagePublicId?: string
}) {
  const tenantId = req.tenantId!
  await assertNoOpenVisitForVehicle(tenantId, data.vehicleId)

  const bookingType = data.bookingType ?? 'NORMAL'
  const pickupRequired = data.pickupRequired ?? (bookingType === 'BREAKDOWN_ON_SPOT'
    || data.arrivalMethod === 'PICKUP')
  const arrivalMethod: ArrivalMethod = pickupRequired ? 'PICKUP' : (data.arrivalMethod ?? 'SELF')
  const bookingCharge = bookingType === 'BREAKDOWN_ON_SPOT' ? 0 : 0

  const initialStatus: BookingStatus = pickupRequired ? 'AWAITING_PICKUP' : 'AWAITING_GATE_IN'

  const bookingNumber = await generateDocumentNumber(tenantId, 'BOOKING')

  await syncVehicleDetails(req, data.vehicleId, data)

  const booking = await Booking.create({
    tenantId,
    branchId: data.branchId,
    bookingNumber,
    bookingDate: new Date(),
    bookingType,
    arrivalMethod,
    bookingCharge,
    status: 'CONFIRMED',
    customerId: data.customerId,
    vehicleId: data.vehicleId,
    serviceType: data.serviceType,
    customerComplaint: data.customerComplaint,
    customerPriority: data.customerPriority,
    preferredDate: data.preferredDate ? new Date(data.preferredDate) : undefined,
    preferredSlot: data.preferredSlot,
    pickupRequired,
    pickupAddress: pickupRequired ? data.pickupAddress : undefined,
    pickupLocationLat: pickupRequired ? data.pickupLocationLat : undefined,
    pickupLocationLng: pickupRequired ? data.pickupLocationLng : undefined,
    breakdownDetails: bookingType === 'BREAKDOWN_ON_SPOT' ? data.breakdownDetails : undefined,
    source: data.source,
    remarks: data.remarks,
    advisorId: req.user?.id,
    createdBy: req.user?.id,
  })

  assertBookingStatusTransition('CONFIRMED', initialStatus)
  booking.status = initialStatus
  await booking.save()

  if (pickupRequired) {
    const existingPickup = await PickupTask.findOne({ tenantId, bookingId: booking._id })
    if (!existingPickup) {
      await PickupTask.create({
        tenantId,
        branchId: data.branchId,
        bookingId: booking._id,
        status: 'UNASSIGNED',
        pickupAddress: data.pickupAddress,
        pickupLocationLat: data.pickupLocationLat,
        pickupLocationLng: data.pickupLocationLng,
        recoveryPartner: bookingType === 'BREAKDOWN_ON_SPOT'
          ? (data.breakdownDetails as { recoveryPartner?: string })?.recoveryPartner
          : undefined,
      })
    }
  }

  const created = await Booking.findById(booking._id)
    .populate('customerId', 'name mobile')
    .populate('vehicleId', 'registrationNo make model engineNo chassisNo vin imageUrl')
    .lean()

  return {
    id: booking._id.toString(),
    bookingNumber: booking.bookingNumber,
    bookingDate: booking.bookingDate,
    serviceType: booking.serviceType,
    preferredSlot: booking.preferredSlot,
    status: booking.status,
    customer: created?.customerId as { name: string; mobile?: string } | undefined,
    vehicle: created?.vehicleId as {
      registrationNo: string
      make: string
      model: string
      engineNo?: string
      chassisNo?: string
      imageUrl?: string
    } | undefined,
  }
}

export async function updateBookingStatus(req: Request, id: string, status: BookingStatus) {
  const existing = await Booking.findOne({ _id: id, tenantId: req.tenantId! })
  if (!existing) throw new NotFoundError('Booking not found')

  const from = normalizeBookingStatus(existing.status)
  const to = normalizeBookingStatus(status)
  assertBookingStatusTransition(from, to)

  existing.status = to
  if (to === 'CHECKED_IN') existing.completedGateInAt = new Date()
  existing.updatedBy = req.user?.id as unknown as typeof existing.updatedBy
  await existing.save()
  return getBooking(req, id)
}

export async function updateBooking(req: Request, id: string, data: {
  customerId?: string
  vehicleId?: string
  serviceType?: string
  customerComplaint?: string
  preferredDate?: string
  preferredSlot?: string
  pickupRequired?: boolean
  pickupAddress?: string
  pickupLocationLat?: number
  pickupLocationLng?: number
  source?: string
  remarks?: string
  status?: BookingStatus
  engineNo?: string
  chassisNo?: string
  vehicleImageUrl?: string
  vehicleImagePublicId?: string
}) {
  const existing = await Booking.findOne({ _id: id, tenantId: req.tenantId! })
  if (!existing) throw new NotFoundError('Booking not found')

  if (data.customerId) existing.customerId = data.customerId as unknown as typeof existing.customerId
  if (data.vehicleId) existing.vehicleId = data.vehicleId as unknown as typeof existing.vehicleId
  if (data.serviceType !== undefined) existing.serviceType = data.serviceType
  if (data.customerComplaint !== undefined) existing.customerComplaint = data.customerComplaint
  if (data.preferredDate !== undefined) {
    existing.preferredDate = data.preferredDate ? new Date(data.preferredDate) : undefined
  }
  if (data.preferredSlot !== undefined) existing.preferredSlot = data.preferredSlot
  if (data.pickupRequired !== undefined) {
    existing.pickupRequired = data.pickupRequired
    if (!data.pickupRequired) {
      existing.pickupAddress = undefined
      existing.pickupLocationLat = undefined
      existing.pickupLocationLng = undefined
    }
  }
  if (data.pickupAddress !== undefined) existing.pickupAddress = data.pickupAddress
  if (data.pickupLocationLat !== undefined) existing.pickupLocationLat = data.pickupLocationLat
  if (data.pickupLocationLng !== undefined) existing.pickupLocationLng = data.pickupLocationLng
  if (data.source !== undefined) existing.source = data.source
  if (data.remarks !== undefined) existing.remarks = data.remarks
  if (data.status) existing.status = data.status

  existing.updatedBy = req.user?.id as unknown as typeof existing.updatedBy
  await existing.save()

  await syncVehicleDetails(req, existing.vehicleId.toString(), data)

  return getBooking(req, id)
}
