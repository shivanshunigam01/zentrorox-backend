import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as paymentsService from './payments.service.js'
import * as razorpayService from './razorpay-payment.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/by-visit/:visitId', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const data = await paymentsService.listAdvancesByVisit(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/advances', requirePermission('payments.record'), async (req, res, next) => {
  try {
    const body = z.object({
      serviceVisitId: z.string(),
      receivedAmount: z.number().positive(),
      paymentMode: z.enum(['CASH', 'UPI', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
      paymentReference: z.string().optional(),
      bankUpiReference: z.string().optional(),
      remarks: z.string().optional(),
      paymentDate: z.string().optional(),
      idempotencyKey: z.string().optional(),
    }).parse(req.body)
    const data = await paymentsService.createAdvance(req, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/advances/:id/verify', requirePermission('payments.verify'), async (req, res, next) => {
  try {
    const data = await paymentsService.verifyAdvance(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/advances/:id/reverse', requirePermission('payments.reverse'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body)
    const data = await paymentsService.reverseAdvance(req, String(req.params.id), reason)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/receipts/:id/pdf', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const { buffer, filename } = await paymentsService.getReceiptPdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.post('/receipts/:id/send-email', requirePermission('payments.share'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().email() }).parse(req.body)
    const data = await paymentsService.sendReceiptEmail(req, String(req.params.id), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/receipts/:id/send-whatsapp', requirePermission('payments.share'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().min(8) }).parse(req.body)
    const data = await paymentsService.sendReceiptWhatsApp(req, String(req.params.id), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/razorpay/links', requirePermission('payments.record'), async (req, res, next) => {
  try {
    const { invoiceId } = z.object({ invoiceId: z.string() }).parse(req.body)
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await razorpayService.createRazorpayPaymentLink(req, invoiceId, key)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/razorpay/links/:paymentRequestId/status', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const data = await razorpayService.refreshRazorpayPaymentStatus(req, String(req.params.paymentRequestId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/razorpay/dashboard', requirePermission('payments.view'), async (req, res, next) => {
  try {
    const data = await razorpayService.getRazorpayPaymentsDashboard(req, {
      status: req.query.status as string | undefined,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/razorpay/links/:paymentRequestId/send-email', requirePermission('payments.share'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().email() }).parse(req.body)
    const data = await razorpayService.sendPaymentLinkEmail(req, String(req.params.paymentRequestId), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/razorpay/links/:paymentRequestId/cancel', requirePermission('payments.record'), async (req, res, next) => {
  try {
    const data = await razorpayService.cancelRazorpayPaymentLink(
      req,
      String(req.params.paymentRequestId),
      req.body?.reason as string | undefined,
    )
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/razorpay/links/:paymentRequestId/send-whatsapp', requirePermission('payments.share'), async (req, res, next) => {
  try {
    const { recipient } = z.object({ recipient: z.string().min(8) }).parse(req.body)
    const data = await razorpayService.sendPaymentLinkWhatsApp(req, String(req.params.paymentRequestId), recipient)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
