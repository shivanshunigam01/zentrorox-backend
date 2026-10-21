import { Router } from 'express'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { getAvailability, returnStock, consumeIssuedStock } from './inventory-transaction.service.js'
import { StockLedger, StockReturn } from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { ValidationError, NotFoundError } from '../../utils/errors.js'
import { StockIssue } from '../../models/index.js'

const router = Router()
router.use(authenticate, requireTenant)

router.get('/availability', requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const data = await getAvailability(req, {
      warehouseId: req.query.warehouseId as string,
      partId: req.query.partId as string,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/stock-ledger', requirePermission('inventory.view'), async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = { tenantId: req.tenantId! }
    if (req.query.jobCardId) filter.jobCardId = req.query.jobCardId
    if (req.query.partId) filter.partId = req.query.partId
    const page = Number(req.query.page ?? 1)
    const limit = Math.min(Number(req.query.limit ?? 50), 200)
    const [items, total] = await Promise.all([
      StockLedger.find(filter).sort({ performedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      StockLedger.countDocuments(filter),
    ])
    res.json({ success: true, data: { items, page, limit, total } })
  } catch (err) {
    next(err)
  }
})

router.post('/stock-returns', requirePermission('inventory.return'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    if (key) {
      const dup = await StockReturn.findOne({ tenantId: req.tenantId!, idempotencyKey: key }).lean()
      if (dup) {
        res.json({ success: true, data: dup })
        return
      }
    }
    const { stockIssueId, issueLineId, quantity, reason, condition, jobCardId, warehouseId, partId } = req.body as Record<string, unknown>
    const qty = Number(quantity)
    if (!qty || qty <= 0) throw new ValidationError('Invalid return quantity')

    const issue = await StockIssue.findOne({ _id: stockIssueId, tenantId: req.tenantId! })
    if (!issue) throw new NotFoundError('Stock issue not found')
    const line = issue.lines.find((l) => l._id.toString() === String(issueLineId))
    if (!line) throw new NotFoundError('Issue line not found')
    const maxReturn = line.quantity - (line.quantityReturned ?? 0)
    if (qty > maxReturn) throw new ValidationError('Return quantity exceeds issuable balance')

    await returnStock({
      tenantId: req.tenantId!,
      branchId: req.branchId,
      warehouseId: String(warehouseId ?? issue.warehouseId),
      partId: String(partId ?? line.partId),
      quantity: qty,
      jobCardId: String(jobCardId ?? issue.jobCardId),
      sourceDocumentId: '',
      performedBy: req.user?.id,
      idempotencyKey: key,
      condition: (condition as 'REUSABLE' | 'DAMAGED' | 'SCRAPPED') ?? 'REUSABLE',
    })

    line.quantityReturned = (line.quantityReturned ?? 0) + qty
    await issue.save()

    const returnNumber = await generateDocumentNumber(req.tenantId!, 'STOCK_RETURN')
    const doc = await StockReturn.create({
      tenantId: req.tenantId!,
      branchId: issue.branchId,
      warehouseId: issue.warehouseId,
      returnNumber,
      stockIssueId: issue._id,
      issueLineId: String(issueLineId),
      partId: line.partId,
      jobCardId: issue.jobCardId,
      quantity: qty,
      reason: reason as string,
      condition: condition ?? 'REUSABLE',
      receivedBy: req.user?.id,
      idempotencyKey: key,
    })
    res.status(201).json({ success: true, data: doc })
  } catch (err) {
    next(err)
  }
})

router.post('/consume', requirePermission('inventory.issue'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const b = req.body as Record<string, unknown>
    await consumeIssuedStock({
      tenantId: req.tenantId!,
      branchId: req.branchId,
      warehouseId: String(b.warehouseId),
      partId: String(b.partId),
      quantity: Number(b.quantity),
      jobCardId: String(b.jobCardId),
      workItemId: String(b.workItemId),
      sourceDocumentId: String(b.workItemId),
      performedBy: req.user?.id,
      idempotencyKey: key,
    })
    res.json({ success: true, data: { consumed: true } })
  } catch (err) {
    next(err)
  }
})

export default router
