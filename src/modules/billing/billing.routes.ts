import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import * as billingService from './billing.service.js'
import * as invoiceService from './invoice.service.js'
import * as gatePassService from './gate-pass.service.js'
import * as deliveryService from './delivery.service.js'
import * as feedbackService from './feedback.service.js'
import * as creditNoteService from './credit-note.service.js'
import * as eInvoiceService from '../e-invoice/e-invoice.service.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/dashboard', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await billingService.getBillingDashboard(req) })
  } catch (e) {
    next(e)
  }
})

router.get('/queue', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await billingService.getBillingQueue(req, {
        tab: req.query.tab as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
      }),
    })
  } catch (e) {
    next(e)
  }
})

router.get('/visits/:visitId/reconciliation', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.getVisitReconciliation(req, String(req.params.visitId)) })
  } catch (e) {
    next(e)
  }
})

router.post('/visits/:visitId/reconciliation/resolve', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.resolveReconciliationDiscrepancy(req, String(req.params.visitId), req.body) })
  } catch (e) {
    next(e)
  }
})

router.get('/visits/:visitId/workspace', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.getVisitBillingWorkspace(req, String(req.params.visitId)) })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/from-visit/:visitId', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await invoiceService.createDraftFromVisit(req, String(req.params.visitId), key)
    res.status(data.duplicate ? 200 : 201).json({ success: true, data })
  } catch (e) {
    next(e)
  }
})

router.get('/invoices/:id', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.getInvoice(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/issue', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.issueInvoice(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/e-invoice/irn', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await eInvoiceService.requestIrnForIssuedInvoice(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/e-invoice/cancel', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await eInvoiceService.cancelInvoiceIrn(req, String(req.params.id), String(req.body.reason ?? 'Cancelled')),
    })
  } catch (e) {
    next(e)
  }
})

router.post('/credit-notes', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    res.status(201).json({
      success: true,
      data: await creditNoteService.createCreditNoteDraft(req, { ...req.body, idempotencyKey: key }),
    })
  } catch (e) {
    next(e)
  }
})

router.post('/credit-notes/:id/issue', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await creditNoteService.issueCreditNote(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/credit-notes/apply', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    res.json({
      success: true,
      data: await creditNoteService.applyCreditNoteToInvoice(req, { ...req.body, idempotencyKey: key }),
    })
  } catch (e) {
    next(e)
  }
})

router.post('/credit-notes/:id/cancel', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await creditNoteService.cancelCreditNote(req, String(req.params.id), String(req.body.reason ?? 'Cancelled')),
    })
  } catch (e) {
    next(e)
  }
})

router.get('/invoices/:id/pdf', requirePermission('billing.view'), async (req, res, next) => {
  try {
    const buffer = await invoiceService.getInvoicePdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.send(buffer)
  } catch (e) {
    next(e)
  }
})

router.get('/invoices/:id/repair-report', requirePermission('billing.view'), async (req, res, next) => {
  try {
    const buffer = await invoiceService.getRepairReportPdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.send(buffer)
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/send-email', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const data = await invoiceService.recordCommunication(req, String(req.params.id), 'EMAIL', String(req.body.recipient))
    res.json({ success: true, data })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/send-whatsapp', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const data = await invoiceService.recordCommunication(req, String(req.params.id), 'WHATSAPP', String(req.body.recipient))
    res.json({ success: true, data })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/acknowledge', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.acknowledgeInvoice(req, String(req.params.id), req.body) })
  } catch (e) {
    next(e)
  }
})

router.post('/invoices/:id/credit-clearance', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.authorizeCreditClearance(req, String(req.params.id), req.body) })
  } catch (e) {
    next(e)
  }
})

router.post('/payments/collect', requirePermission('payments.record'), async (req, res, next) => {
  try {
    const data = await invoiceService.collectPayment(req, req.body)
    res.status(201).json({ success: true, data })
  } catch (e) {
    next(e)
  }
})

router.post('/payments/:id/verify', requirePermission('payments.verify'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await invoiceService.verifyInvoicePayment(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/gate-passes/from-invoice/:invoiceId', requirePermission('billing.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    res.json({ success: true, data: await gatePassService.createGatePassFromInvoice(req, String(req.params.invoiceId), key) })
  } catch (e) {
    next(e)
  }
})

router.post('/gate-passes/:id/void', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await gatePassService.voidGatePass(req, String(req.params.id), String(req.body.reason ?? 'Void')) })
  } catch (e) {
    next(e)
  }
})

router.post('/gate-passes/:id/issue', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await gatePassService.issueGatePass(req, String(req.params.id)) })
  } catch (e) {
    next(e)
  }
})

router.post('/deliveries/from-gate-pass/:gatePassId', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await deliveryService.createDeliveryFromGatePass(req, String(req.params.gatePassId)) })
  } catch (e) {
    next(e)
  }
})

router.post('/deliveries/:id/complete', requirePermission('billing.create'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await deliveryService.completeDelivery(req, String(req.params.id), req.body) })
  } catch (e) {
    next(e)
  }
})

router.post('/feedback', async (req, res, next) => {
  try {
    res.status(201).json({ success: true, data: await feedbackService.submitFeedback(req, req.body) })
  } catch (e) {
    next(e)
  }
})

router.get('/feedback/by-visit/:visitId', requirePermission('billing.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await feedbackService.listFeedbackByVisit(req, String(req.params.visitId)) })
  } catch (e) {
    next(e)
  }
})

export default router
