import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as dashboardService from './dashboard.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
  try {
    const data = await dashboardService.getDashboardStats(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
