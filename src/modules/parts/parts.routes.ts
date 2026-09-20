import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as partsService from './parts.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await partsService.getPartsDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/stock', async (req, res, next) => {
  try {
    const data = await partsService.listStock(req, {
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const data = await partsService.listParts(req, {
      search: req.query.search as string | undefined,
      category: req.query.category as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
