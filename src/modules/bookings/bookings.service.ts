import { Booking, ServiceVisit } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import type { Request } from 'express'
import type { BookingStatus } from '../../types/enums.js'

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
    engineNo?: string
    fuelType?: string
    odometer?: number
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
    status: booking.status,
    serviceType: booking.serviceType,
    customerComplaint: booking.customerComplaint,
    preferredSlot: booking.preferredSlot,
    preferredDate: booking.preferredDate,
    pickupRequired: booking.pickupRequired,
    pickupAddress: booking.pickupAddress,
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
          engineNo: vehicle.engineNo,
          fuelType: vehicle.fuelType,
          odometer: vehicle.odometer,
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

export async function createBooking(req: Request, data: {
  branchId: string
  customerId: string
  vehicleId: string
  serviceType?: string
  customerComplaint?: string
  preferredDate?: string
  preferredSlot?: string
  pickupRequired?: boolean
  pickupAddress?: string
  source?: string
  remarks?: string
}) {
  const tenantId = req.tenantId!
  const bookingNumber = await generateDocumentNumber(tenantId, 'BOOKING')

  const booking = await Booking.create({
    tenantId,
    branchId: data.branchId,
    bookingNumber,
    bookingDate: new Date(),
    customerId: data.customerId,
    vehicleId: data.vehicleId,
    serviceType: data.serviceType,
    customerComplaint: data.customerComplaint,
    preferredDate: data.preferredDate ? new Date(data.preferredDate) : undefined,
    preferredSlot: data.preferredSlot,
    pickupRequired: data.pickupRequired ?? false,
    pickupAddress: data.pickupAddress,
    source: data.source,
    remarks: data.remarks,
    advisorId: req.user?.id,
    createdBy: req.user?.id,
  })

  const created = await Booking.findById(booking._id)
    .populate('customerId', 'name mobile')
    .populate('vehicleId', 'registrationNo make model')
    .lean()

  return {
    id: booking._id.toString(),
    bookingNumber: booking.bookingNumber,
    bookingDate: booking.bookingDate,
    serviceType: booking.serviceType,
    preferredSlot: booking.preferredSlot,
    status: booking.status,
    customer: created?.customerId as { name: string; mobile?: string } | undefined,
    vehicle: created?.vehicleId as { registrationNo: string; make: string; model: string } | undefined,
  }
}

export async function updateBookingStatus(req: Request, id: string, status: BookingStatus) {
  const existing = await Booking.findOne({ _id: id, tenantId: req.tenantId! })
  if (!existing) throw new NotFoundError('Booking not found')

  existing.status = status
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
  source?: string
  remarks?: string
  status?: BookingStatus
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
  if (data.pickupRequired !== undefined) existing.pickupRequired = data.pickupRequired
  if (data.pickupAddress !== undefined) existing.pickupAddress = data.pickupAddress
  if (data.source !== undefined) existing.source = data.source
  if (data.remarks !== undefined) existing.remarks = data.remarks
  if (data.status) existing.status = data.status

  existing.updatedBy = req.user?.id as unknown as typeof existing.updatedBy
  await existing.save()
  return getBooking(req, id)
}
