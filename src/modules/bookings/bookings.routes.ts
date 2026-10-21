import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import { BOOKING_STATUSES, BOOKING_TYPES, ARRIVAL_METHODS } from '../../types/enums.js'
import * as bookingsService from './bookings.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

const createSchema = z.object({
  branchId: z.string().min(1),
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  bookingType: z.enum(BOOKING_TYPES).optional(),
  arrivalMethod: z.enum(ARRIVAL_METHODS).optional(),
  customerPriority: z.string().optional(),
  breakdownDetails: z.record(z.unknown()).optional(),
  serviceType: z.string().optional(),
  customerComplaint: z.string().optional(),
  preferredDate: z.string().optional(),
  preferredSlot: z.string().optional(),
  pickupRequired: z.boolean().optional(),
  pickupAddress: z.string().optional(),
  pickupLocationLat: z.number().optional(),
  pickupLocationLng: z.number().optional(),
  source: z.string().optional(),
  remarks: z.string().optional(),
  engineNo: z.string().optional(),
  chassisNo: z.string().optional(),
  vehicleImageUrl: z.string().optional(),
  vehicleImagePublicId: z.string().optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const data = await bookingsService.listBookings(req, {
      search: req.query.search as string | undefined,
      status: req.query.status as typeof BOOKING_STATUSES[number] | undefined,
      date: req.query.date as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await bookingsService.getBooking(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const data = await bookingsService.createBooking(req, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

const updateSchema = z.object({
  customerId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  serviceType: z.string().optional(),
  customerComplaint: z.string().optional(),
  preferredDate: z.string().optional(),
  preferredSlot: z.string().optional(),
  pickupRequired: z.boolean().optional(),
  pickupAddress: z.string().optional(),
  pickupLocationLat: z.number().optional(),
  pickupLocationLng: z.number().optional(),
  source: z.string().optional(),
  remarks: z.string().optional(),
  bookingType: z.enum(BOOKING_TYPES).optional(),
  arrivalMethod: z.enum(ARRIVAL_METHODS).optional(),
  customerPriority: z.string().optional(),
  breakdownDetails: z.record(z.unknown()).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  engineNo: z.string().optional(),
  chassisNo: z.string().optional(),
  vehicleImageUrl: z.string().optional(),
  vehicleImagePublicId: z.string().optional(),
})

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(BOOKING_STATUSES),
    }).parse(req.body)
    const data = await bookingsService.updateBookingStatus(req, req.params.id, status)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body)
    const data = await bookingsService.updateBooking(req, req.params.id, body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
