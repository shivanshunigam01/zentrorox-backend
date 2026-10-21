import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import * as wipService from './wip.service.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/dashboard', requirePermission('wip.view'), async (req, res, next) => {
  try {
    const data = await wipService.getWipDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('wip.view'), async (req, res, next) => {
  try {
    const data = await wipService.getWipQueue(req, {
      tab: req.query.tab as string,
      search: req.query.search as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
      teamId: req.query.teamId as string,
      mechanicId: req.query.mechanicId as string,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-job-card/:jobCardId', requirePermission('wip.view'), async (req, res, next) => {
  try {
    const data = await wipService.getWipByJobCard(req, String(req.params.jobCardId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/start', requirePermission('wip.start'), async (req, res, next) => {
  try {
    const data = await wipService.startWip(req, String(req.params.jobCardId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:jobCardId/work-items/:itemId', requirePermission('wip.update'), async (req, res, next) => {
  try {
    const data = await wipService.updateWorkItem(req, String(req.params.jobCardId), String(req.params.itemId), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-items/:itemId/complete', requirePermission('wip.complete'), async (req, res, next) => {
  try {
    const data = await wipService.completeWorkItem(req, String(req.params.jobCardId), String(req.params.itemId), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-items/:itemId/verify', requirePermission('wip.verify'), async (req, res, next) => {
  try {
    const data = await wipService.verifyWorkItem(req, String(req.params.jobCardId), String(req.params.itemId), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-sessions/start', requirePermission('wip.update'), async (req, res, next) => {
  try {
    const data = await wipService.startWorkSession(req, String(req.params.jobCardId), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-sessions/:sessionId/pause', requirePermission('wip.update'), async (req, res, next) => {
  try {
    const data = await wipService.pauseWorkSession(req, String(req.params.jobCardId), String(req.params.sessionId), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-sessions/:sessionId/resume', requirePermission('wip.update'), async (req, res, next) => {
  try {
    const data = await wipService.resumeWorkSession(req, String(req.params.jobCardId), String(req.params.sessionId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/work-sessions/:sessionId/end', requirePermission('wip.update'), async (req, res, next) => {
  try {
    const data = await wipService.endWorkSession(req, String(req.params.jobCardId), String(req.params.sessionId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/submit-completion', requirePermission('wip.complete'), async (req, res, next) => {
  try {
    const data = await wipService.submitJobCompletion(req, String(req.params.jobCardId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:jobCardId/verify-completion', requirePermission('wip.verify'), async (req, res, next) => {
  try {
    const data = await wipService.verifyJobCompletion(req, String(req.params.jobCardId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
