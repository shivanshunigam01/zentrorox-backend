import type { Request } from 'express'
import {
  CustomerFeedback,
  FinalInvoice,
  GatePass,
  PaymentRequest,
  QualityControlCase,
  ServiceVisit,
  VehicleDelivery,
} from '../../models/index.js'
import type { BillingQueueTab } from '../../types/enums.js'

export async function getBillingDashboard(req: Request) {
  const tenantId = req.tenantId!
  const branchFilter: Record<string, unknown> = { tenantId }
  if (req.branchId) branchFilter.branchId = req.branchId

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [qcPassed, draft, issued, deliveredToday, feedbackPending] = await Promise.all([
    ServiceVisit.countDocuments({ ...branchFilter, invoiceReady: true }),
    FinalInvoice.countDocuments({ ...branchFilter, status: 'DRAFT' }),
    FinalInvoice.countDocuments({ ...branchFilter, status: 'ISSUED' }),
    VehicleDelivery.countDocuments({ ...branchFilter, status: 'COMPLETED', deliveredAt: { $gte: todayStart } }),
    VehicleDelivery.countDocuments({
      tenantId,
      ...(req.branchId && { branchId: req.branchId }),
      status: 'COMPLETED',
    }).then(async (delivered) => {
      const completed = await VehicleDelivery.find({ tenantId, status: 'COMPLETED' }).select('serviceVisitId')
      const ids = completed.map((d) => d.serviceVisitId)
      const withFb = await CustomerFeedback.countDocuments({ tenantId, serviceVisitId: { $in: ids } })
      return Math.max(0, delivered - withFb)
    }),
  ])

  const issuedAgg = await FinalInvoice.aggregate([
    { $match: { tenantId: req.tenantId!, status: 'ISSUED', ...(req.branchId ? { branchId: req.branchId } : {}) } },
    { $group: { _id: null, total: { $sum: '$grandTotal' }, received: { $sum: '$paymentsReceived' }, due: { $sum: '$balanceDue' } } },
  ])

  const gatePending = await GatePass.countDocuments({
    ...branchFilter,
    status: 'READY_FOR_ISSUE',
  })

  const razorpayPending = await PaymentRequest.countDocuments({
    ...branchFilter,
    reconciliationStatus: { $in: ['PENDING', 'PARTIALLY_RECONCILED'] },
  })

  return {
    vehiclesQcPassed: await QualityControlCase.countDocuments({ tenantId, status: { $in: ['QC_PASSED', 'RELEASED_FOR_INVOICE'] } }),
    razorpayLinksActive: razorpayPending,
    invoicesPending: await ServiceVisit.countDocuments({ ...branchFilter, invoiceReady: true, currentStage: 'INVOICE' }),
    invoicesDraft: draft,
    invoicesIssued: issued,
    totalInvoicedValue: issuedAgg[0]?.total ?? 0,
    confirmedPaymentReceived: issuedAgg[0]?.received ?? 0,
    outstandingReceivables: issuedAgg[0]?.due ?? 0,
    awaitingGatePass: gatePending,
    vehiclesDeliveredToday: deliveredToday,
    feedbackPending,
  }
}

function tabToFilter(tab: BillingQueueTab): Record<string, unknown> {
  switch (tab) {
    case 'READY_FOR_INVOICE':
      return { invoiceReady: true, billingTab: 'ready' }
    case 'DRAFT_INVOICES':
      return { invoiceStatus: 'DRAFT' }
    case 'ISSUED_INVOICES':
      return { invoiceStatus: 'ISSUED' }
    case 'PAYMENT_PENDING':
      return { paymentPending: true }
    case 'CREDIT_CLEARANCE':
      return { creditClearance: true }
    case 'READY_FOR_GATE_PASS':
      return { gatePassReady: true }
    case 'GATE_PASS_ISSUED':
      return { gatePassIssued: true }
    case 'PENDING_DELIVERY':
      return { deliveryPending: true }
    case 'DELIVERED':
      return { delivered: true }
    case 'FEEDBACK_PENDING':
      return { feedbackPending: true }
    default:
      return {}
  }
}

export async function getBillingQueue(req: Request, params: { tab?: string; search?: string; page?: number; limit?: number }) {
  const tenantId = req.tenantId!
  const tab = (params.tab ?? 'READY_FOR_INVOICE') as BillingQueueTab
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const filter = tabToFilter(tab)

  const items: unknown[] = []

  if (filter.invoiceReady) {
    const visits = await ServiceVisit.find({
      tenantId,
      ...(req.branchId && { branchId: req.branchId }),
      invoiceReady: true,
    }).sort({ qcPassedAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
    for (const v of visits) {
      const draft = await FinalInvoice.findOne({ tenantId, serviceVisitId: v._id, status: 'DRAFT' }).lean()
      const issued = await FinalInvoice.findOne({ tenantId, serviceVisitId: v._id, status: 'ISSUED' }).lean()
      if (issued) continue
      items.push({
        serviceVisitId: v._id.toString(),
        visitNumber: v.visitNumber,
        billingStatus: draft ? 'DRAFT' : 'READY',
        invoiceId: draft?._id?.toString(),
      })
    }
    return { items, page, limit, total: items.length }
  }

  if (filter.invoiceStatus) {
    const invs = await FinalInvoice.find({
      tenantId,
      ...(req.branchId && { branchId: req.branchId }),
      status: filter.invoiceStatus,
    }).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean()
    const total = await FinalInvoice.countDocuments({ tenantId, status: filter.invoiceStatus })
    return { items: invs, page, limit, total }
  }

  if (filter.creditClearance) {
    const invs = await FinalInvoice.find({
      tenantId,
      status: 'ISSUED',
      balanceDue: { $gt: 0 },
      creditClearanceAuthorized: false,
    }).limit(limit).lean()
    return { items: invs, page, limit, total: invs.length }
  }

  if (filter.paymentPending) {
    const invs = await FinalInvoice.find({
      tenantId,
      status: 'ISSUED',
      balanceDue: { $gt: 0 },
      creditClearanceAuthorized: false,
    }).limit(limit).lean()
    return { items: invs, page, limit, total: invs.length }
  }

  if (filter.gatePassReady) {
    const invs = await FinalInvoice.find({
      tenantId,
      status: 'ISSUED',
      $or: [{ balanceDue: { $lte: 0 } }, { creditClearanceAuthorized: true }],
    }).limit(limit).lean()
    return { items: invs, page, limit, total: invs.length }
  }

  if (filter.gatePassIssued) {
    const gps = await GatePass.find({ tenantId, status: 'ISSUED' }).limit(limit).lean()
    return { items: gps, page, limit, total: gps.length }
  }

  if (filter.deliveryPending) {
    const d = await VehicleDelivery.find({ tenantId, status: 'PENDING' }).limit(limit).lean()
    return { items: d, page, limit, total: d.length }
  }

  if (filter.delivered) {
    const d = await VehicleDelivery.find({ tenantId, status: 'COMPLETED' }).limit(limit).lean()
    return { items: d, page, limit, total: d.length }
  }

  return { items, page, limit, total: 0 }
}
