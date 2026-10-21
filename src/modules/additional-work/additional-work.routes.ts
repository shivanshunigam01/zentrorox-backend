import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import * as service from './additional-work.service.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/by-job-card/:jobCardId', requirePermission('wip.view'), async (req, res, next) => {
  try {
    const data = await service.listByJobCard(req, String(req.params.jobCardId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/', requirePermission('wip.raise_additional_work'), async (req, res, next) => {
  try {
    const data = await service.createAdditionalWork(req, req.body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit', requirePermission('wip.raise_additional_work'), async (req, res, next) => {
  try {
    const data = await service.submitAdditionalWork(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/send-to-estimate', requirePermission('supplementary_estimates.create'), async (req, res, next) => {
  try {
    const data = await service.sendToEstimate(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
