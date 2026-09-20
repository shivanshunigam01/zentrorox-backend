import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as searchService from './search.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q as string) ?? ''
    const data = await searchService.globalSearch(req, q)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
