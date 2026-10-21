import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as receivingService from './receiving.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/queue', requirePermission('service_visits.view'), async (req, res, next) => {
  try {
    const data = await receivingService.getReceivingQueue(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-visit/:visitId/workspace', requirePermission('service_visits.view'), async (req, res, next) => {
  try {
    const data = await receivingService.getReceivingWorkspace(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-visit/:visitId', requirePermission('service_visits.view'), async (req, res, next) => {
  try {
    const data = await receivingService.getReceivingByVisit(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/by-visit/:visitId/draft', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const body = z.record(z.unknown()).parse(req.body)
    const data = await receivingService.saveReceivingDraft(req, String(req.params.visitId), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/by-visit/:visitId/complete', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const data = await receivingService.completeReceiving(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
