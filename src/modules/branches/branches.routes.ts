import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as branchesService from './branches.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
  try {
    const data = await branchesService.listBranches(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
