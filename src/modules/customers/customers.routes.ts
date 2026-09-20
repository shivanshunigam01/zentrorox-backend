import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as customersService from './customers.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

const createSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().min(10),
  type: z.enum(['INDIVIDUAL', 'FLEET', 'CORPORATE', 'INSURANCE']).optional(),
  alternateMobile: z.string().optional(),
  email: z.string().email().optional(),
  gstin: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pin: z.string().optional(),
  creditLimit: z.number().optional(),
  creditDays: z.number().int().optional(),
})

router.get('/', async (req, res, next) => {
  try {
    const params = {
      search: req.query.search as string | undefined,
      type: req.query.type as 'INDIVIDUAL' | 'FLEET' | 'CORPORATE' | 'INSURANCE' | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    }
    const data = await customersService.listCustomers(req, params)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await customersService.getCustomer(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const data = await customersService.createCustomer(req, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = createSchema.partial().parse(req.body)
    const data = await customersService.updateCustomer(req, req.params.id, body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
