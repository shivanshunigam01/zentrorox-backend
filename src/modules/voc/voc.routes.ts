import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as vocService from './voc.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/by-visit/:visitId', requirePermission('service_visits.view'), async (req, res, next) => {
  try {
    const data = await vocService.getVoc(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/by-visit/:visitId', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      bookingId: z.string().optional(),
      complaints: z.array(z.record(z.unknown())).optional(),
    }).parse(req.body)
    const data = await vocService.upsertVoc(req, String(req.params.visitId), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/by-visit/:visitId/confirm', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const data = await vocService.confirmVoc(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
