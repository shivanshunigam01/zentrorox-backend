import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import * as service from './parts-requisitions.service.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/', requirePermission('wip.view'), async (req, res, next) => {
  try {
    const data = await service.listRequisitions(req, {
      jobCardId: req.query.jobCardId as string,
      status: req.query.status as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/', requirePermission('parts_requisitions.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await service.createRequisition(req, req.body, key)
    res.status(data.duplicate ? 200 : 201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit', requirePermission('parts_requisitions.create'), async (req, res, next) => {
  try {
    const data = await service.submitRequisition(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/approve', requirePermission('parts_requisitions.approve'), async (req, res, next) => {
  try {
    const data = await service.approveRequisition(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/issue', requirePermission('inventory.issue'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await service.issueRequisition(req, String(req.params.id), key)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
