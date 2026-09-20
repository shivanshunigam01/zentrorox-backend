import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as tenantService from './tenant.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/profile', async (req, res, next) => {
  try {
    const data = await tenantService.getTenantProfile(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
