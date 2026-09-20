import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as bookingsService from './bookings.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

const createSchema = z.object({
  branchId: z.string().min(1),
  customerId: z.string().min(1),
  vehicleId: z.string().min(1),
  serviceType: z.string().optional(),
  customerComplaint: z.string().optional(),
  preferredDate: z.string().optional(),
  preferredSlot: z.string().optional(),
  pickupRequired: z.boolean().optional(),
  pickupAddress: z.string().optional(),
  source: z.string().optional(),
  remarks: z.string().optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const data = await bookingsService.listBookings(req, {
      search: req.query.search as string | undefined,
      status: req.query.status as 'BOOKED' | 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'ARRIVED' | 'NO_SHOW' | undefined,
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

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(['BOOKED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'ARRIVED', 'NO_SHOW']),
    }).parse(req.body)
    const data = await bookingsService.updateBookingStatus(req, req.params.id, status)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
