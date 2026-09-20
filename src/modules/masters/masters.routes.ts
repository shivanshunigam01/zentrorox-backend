import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import { MASTER_CATEGORY_KEYS } from '../../types/master-categories.js'
import * as mastersService from './masters.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/categories', (_req, res) => {
  res.json({ success: true, data: mastersService.listCategories() })
})

router.get('/grouped', async (req, res, next) => {
  try {
    const data = await mastersService.listAllGrouped(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/dropdown/:category', async (req, res, next) => {
  try {
    const category = req.params.category as typeof MASTER_CATEGORY_KEYS[number]
    const parentCode = req.query.parentCode as string | undefined
    const data = await mastersService.getDropdownOptions(req, category, parentCode)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:category', async (req, res, next) => {
  try {
    const category = req.params.category as typeof MASTER_CATEGORY_KEYS[number]
    const parentCode = req.query.parentCode as string | undefined
    const data = await mastersService.listByCategory(req, category, parentCode)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

const createSchema = z.object({
  category: z.enum(MASTER_CATEGORY_KEYS as [string, ...string[]]),
  code: z.string().min(1),
  label: z.string().min(1),
  parentCode: z.string().optional(),
  sortOrder: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
})

router.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const data = await mastersService.createMaster(req, body as Parameters<typeof mastersService.createMaster>[1])
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = createSchema.partial().omit({ category: true }).parse(req.body)
    const data = await mastersService.updateMaster(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const data = await mastersService.deactivateMaster(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
