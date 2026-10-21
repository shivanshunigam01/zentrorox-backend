import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import { INSPECTION_CASE_STATUSES } from '../../types/enums.js'
import * as inspectionsService from './inspections.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/dashboard', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const data = await inspectionsService.getInspectionDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const data = await inspectionsService.getInspectionQueue(req, {
      status: req.query.status as typeof INSPECTION_CASE_STATUSES[number] | undefined,
      search: req.query.search as string | undefined,
      inspectorId: req.query.inspectorId as string | undefined,
      priority: req.query.priority as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/masters', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const data = await inspectionsService.listInspectionMasters(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/inspectors', requirePermission('inspections.view', 'service_visits.edit'), async (req, res, next) => {
  try {
    const data = await inspectionsService.listInspectors(req, req.query.vehicleCategory as string | undefined)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/from-visit/:visitId', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const data = await inspectionsService.createInspectionCaseFromVisit(req, String(req.params.visitId))
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const data = await inspectionsService.getInspectionDetail(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/report', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const data = await inspectionsService.getInspectionReport(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/assign', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      inspectorId: z.string().min(1),
      priority: z.string().optional(),
      plannedInspectionAt: z.string().optional(),
      assignmentInstructions: z.string().optional(),
      overrideReason: z.string().optional(),
    }).parse(req.body)
    const data = await inspectionsService.assignInspector(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/start', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const data = await inspectionsService.startInspection(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/pause', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const data = await inspectionsService.pauseInspection(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/resume', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const data = await inspectionsService.resumeInspection(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/trial', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const detail = await inspectionsService.getInspectionDetail(req, String(req.params.id))
    res.json({ success: true, data: detail.trial ?? null })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/trial', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const body = z.record(z.unknown()).parse(req.body)
    const data = await inspectionsService.updateTrial(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/checklist', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const detail = await inspectionsService.getInspectionDetail(req, String(req.params.id))
    res.json({
      success: true,
      data: {
        checklistSnapshot: detail.checklistSnapshot,
        checklistResponses: detail.checklistResponses,
      },
    })
  } catch (err) {
    next(err)
  }
})

router.put('/:id/checklist', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const { responses } = z.object({ responses: z.array(z.record(z.unknown())) }).parse(req.body)
    const data = await inspectionsService.updateChecklist(req, String(req.params.id), responses)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/findings', requirePermission('inspections.view'), async (req, res, next) => {
  try {
    const detail = await inspectionsService.getInspectionDetail(req, String(req.params.id))
    res.json({ success: true, data: detail.findings ?? [] })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/findings', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const body = z.record(z.unknown()).parse(req.body)
    const data = await inspectionsService.addFinding(req, String(req.params.id), body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/findings/:findingId', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const body = z.record(z.unknown()).parse(req.body)
    const data = await inspectionsService.patchFinding(req, String(req.params.id), String(req.params.findingId), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit', requirePermission('inspections.edit'), async (req, res, next) => {
  try {
    const body = z.record(z.unknown()).parse(req.body ?? {})
    const data = await inspectionsService.submitInspection(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/review', requirePermission('inspections.review'), async (req, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['APPROVED', 'REWORK']),
      comments: z.string().optional(),
      reworkInstructions: z.string().optional(),
    }).parse(req.body)
    const data = await inspectionsService.reviewInspection(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
