import type { Request } from 'express'
import { Part, PartsRequisition, JobCard, JobWorkItem, Warehouse } from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { issueStock, reserveStock, sellableAvailable } from '../inventory/inventory-transaction.service.js'
import { StockBalance, StockIssue } from '../../models/index.js'
import { createAuditLog } from '../../utils/audit.js'

export async function listRequisitions(req: Request, params: { jobCardId?: string; status?: string; page?: number; limit?: number }) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const filter: Record<string, unknown> = { tenantId }
  if (req.branchId) filter.branchId = req.branchId
  if (params.jobCardId) filter.jobCardId = params.jobCardId
  if (params.status) filter.status = params.status
  const [items, total] = await Promise.all([
    PartsRequisition.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PartsRequisition.countDocuments(filter),
  ])
  return { items, page, limit, total }
}

export async function createRequisition(req: Request, body: Record<string, unknown>, idempotencyKey?: string) {
  if (idempotencyKey) {
    const dup = await PartsRequisition.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return { requisition: dup, duplicate: true }
  }

  const jobCardId = String(body.jobCardId)
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const warehouseId = String(body.warehouseId)
  const wh = await Warehouse.findOne({ _id: warehouseId, tenantId: req.tenantId!, isActive: true })
  if (!wh) throw new ValidationError('Invalid warehouse')

  const linesIn = (body.lines as Array<Record<string, unknown>>) ?? []
  if (!linesIn.length) throw new ValidationError('At least one line required')

  const lines = []
  for (const ln of linesIn) {
    const partId = String(ln.partId)
    const part = await Part.findOne({ _id: partId, tenantId: req.tenantId!, isActive: true })
    if (!part) throw new ValidationError('Invalid or inactive part')
    const qty = Number(ln.quantityRequested)
    if (!qty || qty <= 0) throw new ValidationError('Quantity must be positive')
    const workItemId = ln.workItemId ? String(ln.workItemId) : undefined
    if (workItemId) {
      const wi = await JobWorkItem.findOne({ _id: workItemId, jobCardId: jc._id })
      if (!wi) throw new ValidationError('Work item does not belong to job card')
    }
    lines.push({
      partId: part._id,
      partNumber: part.partNumber,
      description: part.description,
      uom: part.uom,
      quantityRequested: qty,
      workItemId,
      estimateLineId: ln.estimateLineId as string | undefined,
      chargeable: ln.chargeable !== false,
    })
  }

  const requisitionNumber = await generateDocumentNumber(req.tenantId!, 'PARTS_REQUISITION')
  const reqDoc = await PartsRequisition.create({
    tenantId: req.tenantId!,
    branchId: jc.branchId,
    warehouseId,
    requisitionNumber,
    jobCardId: jc._id,
    jobCardRevisionNumber: jc.revisionNumber ?? 1,
    workItemId: body.workItemId,
    requestedBy: req.user?.id,
    requiredDate: body.requiredDate ? new Date(String(body.requiredDate)) : undefined,
    priority: body.priority as string | undefined,
    remarks: body.remarks as string | undefined,
    status: 'DRAFT',
    lines,
    idempotencyKey,
  })

  await createAuditLog({ req, module: 'parts_requisitions', action: 'CREATED', recordId: reqDoc._id.toString() })
  return { requisition: reqDoc, duplicate: false }
}

export async function submitRequisition(req: Request, id: string) {
  const doc = await PartsRequisition.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Requisition not found')
  if (doc.status !== 'DRAFT') throw new ValidationError('Only draft requisitions can be submitted')
  doc.status = 'SUBMITTED'
  doc.approvalHistory.push({ action: 'SUBMITTED', at: new Date(), by: req.user?.id })
  await doc.save()
  return doc
}

export async function approveRequisition(req: Request, id: string, body: Record<string, unknown>) {
  const doc = await PartsRequisition.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Requisition not found')
  if (!['SUBMITTED', 'PARTIALLY_APPROVED'].includes(doc.status)) {
    throw new ValidationError('Requisition not in approvable state')
  }

  const lineApprovals = (body.lines as Array<{ lineId: string; quantityApproved: number }>) ?? []
  for (const la of lineApprovals) {
    const line = doc.lines.id(la.lineId)
    if (!line) continue
    line.quantityApproved = la.quantityApproved
    const bal = await StockBalance.findOne({
      tenantId: req.tenantId!,
      partId: line.partId,
      warehouseId: doc.warehouseId,
    }).lean()
    const avail = bal ? sellableAvailable(bal) : 0
    if (la.quantityApproved > avail) {
      throw new ValidationError(`Insufficient stock for ${line.partNumber}`)
    }
  }

  const allApproved = doc.lines.every((l) => (l.quantityApproved ?? 0) >= l.quantityRequested)
  doc.status = allApproved ? 'APPROVED' : 'PARTIALLY_APPROVED'
  doc.approvalHistory.push({ action: 'APPROVED', at: new Date(), by: req.user?.id, remarks: body.remarks as string })
  await doc.save()

  for (const line of doc.lines) {
    const qty = line.quantityApproved ?? 0
    if (qty > 0) {
      await reserveStock({
        tenantId: req.tenantId!,
        branchId: doc.branchId?.toString(),
        warehouseId: doc.warehouseId.toString(),
        partId: line.partId.toString(),
        quantity: qty,
        requisitionId: doc._id.toString(),
        performedBy: req.user?.id,
        idempotencyKey: `reserve-${doc._id}-${line._id}`,
      })
    }
  }
  return doc
}

export async function issueRequisition(req: Request, id: string, idempotencyKey?: string) {
  const doc = await PartsRequisition.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Requisition not found')
  if (!['APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_ISSUED'].includes(doc.status)) {
    throw new ValidationError('Requisition not approved for issue')
  }

  if (idempotencyKey) {
    const dup = await StockIssue.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return dup
  }

  const issueNumber = await generateDocumentNumber(req.tenantId!, 'STOCK_ISSUE')
  const issueLines = []
  for (const line of doc.lines) {
    const toIssue = (line.quantityApproved ?? 0) - (line.quantityIssued ?? 0)
    if (toIssue <= 0) continue
    await issueStock({
      tenantId: req.tenantId!,
      branchId: doc.branchId?.toString(),
      warehouseId: doc.warehouseId.toString(),
      partId: line.partId.toString(),
      quantity: toIssue,
      jobCardId: doc.jobCardId.toString(),
      workItemId: line.workItemId?.toString(),
      requisitionId: doc._id.toString(),
      sourceDocumentType: 'PartsRequisition',
      sourceDocumentId: doc._id.toString(),
      performedBy: req.user?.id,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}-${line._id}` : `issue-${doc._id}-${line._id}`,
      releaseReservationQty: toIssue,
    })
    line.quantityIssued = (line.quantityIssued ?? 0) + toIssue
    issueLines.push({
      partId: line.partId,
      requisitionLineId: line._id.toString(),
      quantity: toIssue,
      workItemId: line.workItemId,
    })
  }

  const issue = await StockIssue.create({
    tenantId: req.tenantId!,
    branchId: doc.branchId,
    warehouseId: doc.warehouseId,
    issueNumber,
    requisitionId: doc._id,
    jobCardId: doc.jobCardId,
    lines: issueLines,
    issuedBy: req.user?.id,
    idempotencyKey,
  })

  const allIssued = doc.lines.every((l) => (l.quantityIssued ?? 0) >= (l.quantityApproved ?? l.quantityRequested))
  doc.status = allIssued ? 'ISSUED' : 'PARTIALLY_ISSUED'
  await doc.save()
  return issue
}
