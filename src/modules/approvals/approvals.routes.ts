import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as approvalsService from './approvals.service.js'
import * as financialAuthService from './financial-auth.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/dashboard', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const data = await approvalsService.getApprovalDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const data = await approvalsService.getApprovalQueue(req, {
      tab: req.query.tab as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
      advisorId: req.query.advisorId as string | undefined,
      customerId: req.query.customerId as string | undefined,
      fromDate: req.query.fromDate as string | undefined,
      toDate: req.query.toDate as string | undefined,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-vehicle', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const q = z.object({ q: z.string().min(2) }).parse({ q: req.query.q })
    const data = await approvalsService.searchByVehicle(req, q.q)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-visit/:visitId', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const data = await approvalsService.getApprovalWorkspace(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/by-visit/:visitId/decision', requirePermission('approvals.record'), async (req, res, next) => {
  try {
    const body = z.object({
      decision: z.enum(['FULLY_APPROVED', 'PARTIALLY_APPROVED', 'REVISION_REQUESTED', 'REJECTED']),
      approvedLineIds: z.array(z.string()).optional(),
      rejectedLineIds: z.array(z.string()).optional(),
      approvalSource: z.string().min(1),
      customerRemarks: z.string().optional(),
      advisorRemarks: z.string().optional(),
      customerVerificationMethod: z.string().optional(),
      termsAccepted: z.boolean().optional(),
      confirmationReference: z.string().optional(),
      contactedNumber: z.string().optional(),
      callDateTime: z.string().optional(),
      evidenceReferences: z.array(z.string()).optional(),
      idempotencyKey: z.string().optional(),
    }).parse(req.body)
    const data = await approvalsService.recordApprovalDecision(req, String(req.params.visitId), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/financial-authorization/by-visit/:visitId', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const data = await financialAuthService.getFinancialAuthorization(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/financial-authorization/:visitId/evaluate', requirePermission('approvals.view'), async (req, res, next) => {
  try {
    const data = await financialAuthService.evaluateFinancialAuthorization(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/financial-authorization/:visitId/exception', requirePermission('financial_auth.exception'), async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().min(3), expiresAt: z.string().optional() }).parse(req.body)
    const data = await financialAuthService.approveFinancialException(req, String(req.params.visitId), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/financial-authorization/:visitId/job-card', requirePermission('approvals.job_card_authorize'), async (req, res, next) => {
  try {
    const data = await financialAuthService.authorizeJobCard(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
