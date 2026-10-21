import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import * as qcService from './qc.service.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/dashboard', requirePermission('qc.view'), async (req, res, next) => {
  try {
    const data = await qcService.getQcDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('qc.view'), async (req, res, next) => {
  try {
    const data = await qcService.getQcQueue(req, {
      tab: req.query.tab as string,
      search: req.query.search as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/inspectors', requirePermission('qc.assign'), async (req, res, next) => {
  try {
    const data = await qcService.listEligibleInspectors(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/from-job-card/:jobCardId', requirePermission('qc.view'), async (req, res, next) => {
  try {
    const data = await qcService.createFromJobCard(req, String(req.params.jobCardId))
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requirePermission('qc.view'), async (req, res, next) => {
  try {
    const data = await qcService.getQcWorkspace(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/assign', requirePermission('qc.assign'), async (req, res, next) => {
  try {
    const data = await qcService.assignInspector(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/start', requirePermission('qc.start'), async (req, res, next) => {
  try {
    const data = await qcService.startQc(req, String(req.params.id))
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/checklist', requirePermission('qc.edit'), async (req, res, next) => {
  try {
    const data = await qcService.updateChecklist(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/quantity-verification', requirePermission('qc.edit'), async (req, res, next) => {
  try {
    const data = await qcService.updateQuantityVerification(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/voc-verification', requirePermission('qc.edit'), async (req, res, next) => {
  try {
    const data = await qcService.updateVocVerification(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/road-test', requirePermission('qc.edit'), async (req, res, next) => {
  try {
    const data = await qcService.updateRoadTest(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit', requirePermission('qc.submit'), async (req, res, next) => {
  try {
    const data = await qcService.submitQc(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/pass', requirePermission('qc.pass'), async (req, res, next) => {
  try {
    const data = await qcService.passQc(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/fail', requirePermission('qc.fail'), async (req, res, next) => {
  try {
    const data = await qcService.failQc(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/rework-request', requirePermission('qc.rework'), async (req, res, next) => {
  try {
    const data = await qcService.createReworkRequest(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/attempts', requirePermission('qc.view'), async (req, res, next) => {
  try {
    const workspace = await qcService.getQcWorkspace(req, String(req.params.id))
    res.json({ success: true, data: workspace.attempts })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/pdf', requirePermission('qc.print'), async (req, res, next) => {
  try {
    const buffer = await qcService.getQcPdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="qc-${req.params.id}.pdf"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

export default router
