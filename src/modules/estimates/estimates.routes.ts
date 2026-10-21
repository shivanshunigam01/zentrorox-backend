import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as estimatesService from './estimates.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/dashboard', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.getEstimateDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.getEstimateQueue(req, {
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/parts', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.listPartsForEstimate(req, req.query.search as string | undefined)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/tax-rules', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.listTaxRules(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/discounts', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.listDiscounts(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/from-inspection/:inspectionCaseId', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const data = await estimatesService.createFromInspectionCase(req, String(req.params.inspectionCaseId))
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.getEstimate(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/job-card-handoff', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const data = await estimatesService.getJobCardHandoff(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/pdf', requirePermission('estimates.view'), async (req, res, next) => {
  try {
    const { buffer, filename } = await estimatesService.getEstimatePdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/draft', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const body = z.object({
      items: z.array(z.record(z.unknown())),
      version: z.number().optional(),
    }).parse(req.body)
    const data = await estimatesService.saveDraft(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/submit-review', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const data = await estimatesService.submitInternalReview(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/internal-approve', requirePermission('estimates.approve'), async (req, res, next) => {
  try {
    const data = await estimatesService.approveForSharing(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/issue', requirePermission('estimates.approve'), async (req, res, next) => {
  try {
    const data = await estimatesService.issueEstimate(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/revise', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const data = await estimatesService.createRevision(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/add-pickup-charge', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const data = await estimatesService.addLogisticsChargesFromBooking(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/send-email', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().email() }).parse(req.body)
    const data = await estimatesService.sendEstimateEmail(req, String(req.params.id), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/send-whatsapp', requirePermission('estimates.create'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().min(8) }).parse(req.body)
    const data = await estimatesService.sendEstimateWhatsApp(req, String(req.params.id), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/customer-decision', requirePermission('estimates.approve'), async (req, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['FULL_APPROVAL', 'PARTIAL_APPROVAL', 'REVISION_REQUESTED', 'REJECTED']),
      approvedLineIds: z.array(z.string()).optional(),
      rejectedLineIds: z.array(z.string()).optional(),
      remarks: z.string().optional(),
      verificationMethod: z.string().optional(),
    }).parse(req.body)
    const data = await estimatesService.recordCustomerDecision(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
