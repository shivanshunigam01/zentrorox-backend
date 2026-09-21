import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as vehiclesService from './vehicles.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

const createSchema = z.object({
  customerId: z.string().min(1),
  registrationNo: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  variant: z.string().optional(),
  vin: z.string().optional(),
  chassisNo: z.string().optional(),
  engineNo: z.string().optional(),
  fuelType: z.string().optional(),
  transmission: z.string().optional(),
  colour: z.string().optional(),
  manufacturingYear: z.number().int().optional(),
  odometer: z.number().int().optional(),
  imageUrl: z.string().optional(),
  imagePublicId: z.string().optional(),
})

const updateSchema = z.object({
  engineNo: z.string().optional(),
  chassisNo: z.string().optional(),
  vin: z.string().optional(),
  imageUrl: z.string().optional(),
  imagePublicId: z.string().optional(),
  odometer: z.number().optional(),
  fuelType: z.string().optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const data = await vehiclesService.listVehicles(req, {
      search: req.query.search as string | undefined,
      customerId: req.query.customerId as string | undefined,
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
    const data = await vehiclesService.getVehicle(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const data = await vehiclesService.createVehicle(req, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body)
    const data = await vehiclesService.updateVehicle(req, req.params.id, body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
