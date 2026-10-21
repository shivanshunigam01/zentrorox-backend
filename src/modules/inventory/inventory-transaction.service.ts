import type { ClientSession } from 'mongoose'
import { StockBalance, StockLedger, Part } from '../../models/index.js'
import { mongoose } from '../../lib/mongoose.js'
import { ValidationError, NotFoundError } from '../../utils/errors.js'
import type { StockTransactionType } from '../../types/enums.js'

export function effectiveOnHand(row: { onHand?: number; available?: number; reserved?: number }) {
  if (row.onHand != null && row.onHand > 0) return row.onHand
  return (row.available ?? 0) + (row.reserved ?? 0)
}

export function sellableAvailable(row: { onHand?: number; available?: number; reserved?: number }) {
  return effectiveOnHand(row) - (row.reserved ?? 0)
}

async function getBalance(
  tenantId: string,
  partId: string,
  warehouseId: string,
  session?: ClientSession,
) {
  const q = StockBalance.findOne({ tenantId, partId, warehouseId })
  if (session) q.session(session)
  const row = await q
  if (!row) throw new NotFoundError('Stock balance not found for part/warehouse')
  return row
}

async function writeLedger(
  payload: {
    tenantId: string
    branchId?: string
    warehouseId: string
    partId: string
    transactionType: StockTransactionType
    quantity: number
    unit?: string
    unitCostSnapshot?: number
    sourceDocumentType?: string
    sourceDocumentId?: string
    jobCardId?: string
    workItemId?: string
    requisitionId?: string
    performedBy?: string
    idempotencyKey?: string
    remarks?: string
  },
  session?: ClientSession,
) {
  if (payload.idempotencyKey) {
    const dup = await StockLedger.findOne({ tenantId: payload.tenantId, idempotencyKey: payload.idempotencyKey }).session(session ?? null)
    if (dup) return dup
  }
  const docs = await StockLedger.create([payload], { session })
  return docs[0]
}

export async function reserveStock(params: {
  tenantId: string
  branchId?: string
  warehouseId: string
  partId: string
  quantity: number
  requisitionId: string
  performedBy?: string
  idempotencyKey?: string
}) {
  if (params.quantity <= 0) throw new ValidationError('Quantity must be positive')
  const run = async (session: ClientSession) => {
    const row = await getBalance(params.tenantId, params.partId, params.warehouseId, session)
    const avail = sellableAvailable(row)
    if (avail < params.quantity) throw new ValidationError('Insufficient stock to reserve')
    row.reserved = (row.reserved ?? 0) + params.quantity
    row.onHand = effectiveOnHand(row)
    row.available = sellableAvailable(row)
    await row.save({ session })
    const part = await Part.findById(params.partId).session(session).lean()
    await writeLedger(
      {
        tenantId: params.tenantId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        partId: params.partId,
        transactionType: 'RESERVE',
        quantity: params.quantity,
        unit: part?.uom,
        unitCostSnapshot: part?.mrp ?? undefined,
        sourceDocumentType: 'PartsRequisition',
        sourceDocumentId: params.requisitionId,
        requisitionId: params.requisitionId,
        performedBy: params.performedBy,
        idempotencyKey: params.idempotencyKey,
      },
      session,
    )
    return row
  }
  const session = await mongoose.startSession()
  try {
    session.startTransaction()
    const result = await run(session)
    await session.commitTransaction()
    return result
  } catch (e) {
    await session.abortTransaction()
    throw e
  } finally {
    session.endSession()
  }
}

export async function issueStock(params: {
  tenantId: string
  branchId?: string
  warehouseId: string
  partId: string
  quantity: number
  jobCardId: string
  workItemId?: string
  requisitionId?: string
  sourceDocumentType: string
  sourceDocumentId: string
  performedBy?: string
  idempotencyKey?: string
  releaseReservationQty?: number
}) {
  if (params.quantity <= 0) throw new ValidationError('Quantity must be positive')
  const run = async (session: ClientSession) => {
    const row = await getBalance(params.tenantId, params.partId, params.warehouseId, session)
    const release = params.releaseReservationQty ?? 0
    if (release > 0) {
      if ((row.reserved ?? 0) < release) throw new ValidationError('Reservation release exceeds reserved quantity')
      row.reserved = (row.reserved ?? 0) - release
    }
    const onHand = effectiveOnHand(row)
    const avail = onHand - (row.reserved ?? 0)
    if (avail < params.quantity) throw new ValidationError('Insufficient stock to issue')
    row.onHand = onHand - params.quantity
    row.issuedToWip = (row.issuedToWip ?? 0) + params.quantity
    row.available = row.onHand - (row.reserved ?? 0)
    await row.save({ session })
    const part = await Part.findById(params.partId).session(session).lean()
    await writeLedger(
      {
        tenantId: params.tenantId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        partId: params.partId,
        transactionType: 'ISSUE',
        quantity: params.quantity,
        unit: part?.uom,
        unitCostSnapshot: part?.mrp ?? undefined,
        sourceDocumentType: params.sourceDocumentType,
        sourceDocumentId: params.sourceDocumentId,
        jobCardId: params.jobCardId,
        workItemId: params.workItemId,
        requisitionId: params.requisitionId,
        performedBy: params.performedBy,
        idempotencyKey: params.idempotencyKey,
      },
      session,
    )
    return row
  }
  const session = await mongoose.startSession()
  try {
    session.startTransaction()
    const result = await run(session)
    await session.commitTransaction()
    return result
  } catch (e) {
    await session.abortTransaction()
    throw e
  } finally {
    session.endSession()
  }
}

export async function consumeIssuedStock(params: {
  tenantId: string
  branchId?: string
  warehouseId: string
  partId: string
  quantity: number
  jobCardId: string
  workItemId: string
  sourceDocumentId: string
  performedBy?: string
  idempotencyKey?: string
}) {
  if (params.quantity <= 0) throw new ValidationError('Quantity must be positive')
  const run = async (session: ClientSession) => {
    const row = await getBalance(params.tenantId, params.partId, params.warehouseId, session)
    if ((row.issuedToWip ?? 0) < params.quantity) {
      throw new ValidationError('Cannot consume more than issued to WIP')
    }
    row.issuedToWip = (row.issuedToWip ?? 0) - params.quantity
    await row.save({ session })
    const part = await Part.findById(params.partId).session(session).lean()
    await writeLedger(
      {
        tenantId: params.tenantId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        partId: params.partId,
        transactionType: 'CONSUME',
        quantity: params.quantity,
        unit: part?.uom,
        unitCostSnapshot: part?.mrp ?? undefined,
        sourceDocumentType: 'JobWorkItem',
        sourceDocumentId: params.sourceDocumentId,
        jobCardId: params.jobCardId,
        workItemId: params.workItemId,
        performedBy: params.performedBy,
        idempotencyKey: params.idempotencyKey,
      },
      session,
    )
    return row
  }
  const session = await mongoose.startSession()
  try {
    session.startTransaction()
    const result = await run(session)
    await session.commitTransaction()
    return result
  } catch (e) {
    await session.abortTransaction()
    throw e
  } finally {
    session.endSession()
  }
}

export async function returnStock(params: {
  tenantId: string
  branchId?: string
  warehouseId: string
  partId: string
  quantity: number
  jobCardId: string
  sourceDocumentId: string
  performedBy?: string
  idempotencyKey?: string
  condition: 'REUSABLE' | 'DAMAGED' | 'SCRAPPED'
}) {
  if (params.quantity <= 0) throw new ValidationError('Quantity must be positive')
  const run = async (session: ClientSession) => {
    const row = await getBalance(params.tenantId, params.partId, params.warehouseId, session)
    if ((row.issuedToWip ?? 0) < params.quantity) {
      throw new ValidationError('Return exceeds issued quantity')
    }
    row.issuedToWip = (row.issuedToWip ?? 0) - params.quantity
    if (params.condition === 'REUSABLE') {
      row.onHand = effectiveOnHand(row) + params.quantity
      row.available = row.onHand - (row.reserved ?? 0)
    }
    await row.save({ session })
    const part = await Part.findById(params.partId).session(session).lean()
    await writeLedger(
      {
        tenantId: params.tenantId,
        branchId: params.branchId,
        warehouseId: params.warehouseId,
        partId: params.partId,
        transactionType: 'RETURN',
        quantity: params.quantity,
        unit: part?.uom,
        unitCostSnapshot: part?.mrp ?? undefined,
        sourceDocumentType: 'StockReturn',
        sourceDocumentId: params.sourceDocumentId,
        jobCardId: params.jobCardId,
        performedBy: params.performedBy,
        idempotencyKey: params.idempotencyKey,
        remarks: params.condition,
      },
      session,
    )
    return row
  }
  const session = await mongoose.startSession()
  try {
    session.startTransaction()
    const result = await run(session)
    await session.commitTransaction()
    return result
  } catch (e) {
    await session.abortTransaction()
    throw e
  } finally {
    session.endSession()
  }
}

export async function getAvailability(req: { tenantId?: string | null }, params: { warehouseId?: string; partId?: string }) {
  const tenantId = req.tenantId!
  const filter: Record<string, unknown> = { tenantId }
  if (params.warehouseId) filter.warehouseId = params.warehouseId
  if (params.partId) filter.partId = params.partId
  const rows = await StockBalance.find(filter).populate('partId', 'partNumber description uom mrp').lean()
  return rows.map((s) => {
    const part = s.partId as { partNumber?: string; description?: string; uom?: string; mrp?: number; _id?: unknown }
    const onHand = effectiveOnHand(s)
    const reserved = s.reserved ?? 0
    return {
      partId: (part?._id ?? s.partId).toString(),
      partNumber: part?.partNumber,
      description: part?.description,
      warehouseId: s.warehouseId.toString(),
      onHand,
      reserved,
      available: onHand - reserved,
      issuedToWip: s.issuedToWip ?? 0,
    }
  })
}
