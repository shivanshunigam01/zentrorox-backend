import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as baysService from './bays.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
  try {
    const data = await baysService.listBays(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
