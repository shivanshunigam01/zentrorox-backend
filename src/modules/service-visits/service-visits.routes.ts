import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as serviceVisitsService from './service-visits.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
  try {
    const data = await serviceVisitsService.listServiceVisits(req, {
      search: req.query.search as string | undefined,
      stage: req.query.stage as Parameters<typeof serviceVisitsService.listServiceVisits>[1]['stage'],
      outstandingOnly: req.query.outstandingOnly === 'true',
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/wip', async (req, res, next) => {
  try {
    const data = await serviceVisitsService.getWipBoard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await serviceVisitsService.getServiceVisit(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/from-booking/:bookingId', async (req, res, next) => {
  try {
    const data = await serviceVisitsService.createFromBooking(req, req.params.bookingId)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = z.object({
      odometer: z.number().optional(),
      fuelLevel: z.string().optional(),
      promiseTime: z.string().optional(),
      remarks: z.string().optional(),
      outstanding: z.number().optional(),
      engineNo: z.string().optional(),
      chassisNo: z.string().optional(),
      vehicleImageUrl: z.string().optional(),
      vehicleImagePublicId: z.string().optional(),
    }).parse(req.body)
    const data = await serviceVisitsService.updateServiceVisit(req, req.params.id, body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/pickup/assign', async (req, res, next) => {
  try {
    const { executiveId } = z.object({ executiveId: z.string().min(1) }).parse(req.body)
    const data = await serviceVisitsService.assignPickupExecutive(req, req.params.id, executiveId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/pickup/images', async (req, res, next) => {
  try {
    const body = z.object({
      type: z.enum(['FRONT', 'REAR', 'LEFT', 'RIGHT', 'STEPNEY', 'INTERIOR', 'OTHER_GOODS']),
      url: z.string().url(),
      publicId: z.string().optional(),
      caption: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      capturedAt: z.string(),
    }).parse(req.body)
    const data = await serviceVisitsService.addPickupImage(req, req.params.id, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/pickup/images/:index', async (req, res, next) => {
  try {
    const index = Number(req.params.index)
    const data = await serviceVisitsService.removePickupImage(req, req.params.id, index)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/pickup/complete', async (req, res, next) => {
  try {
    const data = await serviceVisitsService.completePickup(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/advance-stage', async (req, res, next) => {
  try {
    const { stage } = z.object({
      stage: z.enum([
        'BOOKING', 'PICKUP', 'ARRIVAL', 'INVENTORY', 'VOC', 'INSPECTION',
        'DIAGNOSIS', 'ESTIMATE', 'APPROVAL', 'JOB_CARD', 'ASSIGNMENT', 'BAY',
        'WIP', 'QC', 'ROAD_TEST', 'INVOICE', 'PAYMENT', 'GATEPASS',
        'DELIVERY', 'FEEDBACK', 'PSF',
      ]),
    }).parse(req.body)
    const data = await serviceVisitsService.advanceStage(req, req.params.id, stage)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
