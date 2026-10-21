import { Part, PartsRequisition, StockIssue, StockLedger, StockReturn } from '../../models/index.js'
import type { QcQuantityResult } from '../../types/enums.js'

export type QuantityLineSnapshot = {
  partId?: string
  partNumber: string
  description?: string
  uom?: string
  jobWorkItemId?: string
  approvedQuantity: number
  requestedQuantity: number
  issuedQuantity: number
  consumedQuantity: number
  returnedQuantity: number
  scrapQuantity: number
  outstandingQuantity: number
  result: QcQuantityResult
  blocking: boolean
  inspectorRemarks?: string
}

export async function buildQuantitySnapshots(tenantId: string, jobCardId: string): Promise<QuantityLineSnapshot[]> {
  const requisitions = await PartsRequisition.find({ tenantId, jobCardId }).lean()
  const issues = await StockIssue.find({ tenantId, jobCardId }).lean()
  const returns = await StockReturn.find({ tenantId, jobCardId }).lean()
  const ledger = await StockLedger.find({ tenantId, jobCardId }).lean()

  const partAgg = new Map<string, QuantityLineSnapshot>()

  for (const req of requisitions) {
    for (const line of req.lines ?? []) {
      const pid = line.partId?.toString()
      const key = `${pid}-${line.workItemId?.toString() ?? 'na'}`
      const cur = partAgg.get(key) ?? {
        partId: pid,
        partNumber: line.partNumber ?? '',
        description: line.description ?? undefined,
        uom: line.uom ?? undefined,
        jobWorkItemId: line.workItemId?.toString(),
        approvedQuantity: 0,
        requestedQuantity: 0,
        issuedQuantity: 0,
        consumedQuantity: 0,
        returnedQuantity: 0,
        scrapQuantity: 0,
        outstandingQuantity: 0,
        result: 'PENDING' as QcQuantityResult,
        blocking: false,
      }
      cur.requestedQuantity += line.quantityRequested ?? 0
      cur.approvedQuantity += line.quantityApproved ?? line.quantityRequested ?? 0
      cur.issuedQuantity += line.quantityIssued ?? 0
      cur.consumedQuantity += line.quantityConsumed ?? 0
      cur.returnedQuantity += line.quantityReturned ?? 0
      partAgg.set(key, cur)
    }
  }

  for (const issue of issues) {
    for (const line of issue.lines ?? []) {
      const pid = line.partId?.toString()
      const key = `${pid}-${line.workItemId?.toString() ?? 'na'}`
      const cur = partAgg.get(key)
      if (cur) cur.issuedQuantity = Math.max(cur.issuedQuantity, line.quantity ?? 0)
    }
  }

  for (const row of ledger) {
    if (row.transactionType === 'CONSUME') {
      const pid = row.partId.toString()
      const key = `${pid}-${row.workItemId?.toString() ?? 'na'}`
      const cur = partAgg.get(key)
      if (cur) cur.consumedQuantity += row.quantity
    }
  }

  for (const ret of returns) {
    const pid = ret.partId.toString()
    const key = `${pid}-na`
    for (const [k, cur] of partAgg) {
      if (k.startsWith(pid)) {
        cur.returnedQuantity += ret.quantity
        if (ret.condition === 'SCRAPPED') cur.scrapQuantity += ret.quantity
      }
    }
  }

  const lines: QuantityLineSnapshot[] = []
  for (const cur of partAgg.values()) {
    const accounted = cur.consumedQuantity + cur.returnedQuantity + cur.scrapQuantity
    cur.outstandingQuantity = Math.max(0, cur.issuedQuantity - accounted)
    if (cur.issuedQuantity === 0 && cur.requestedQuantity === 0) continue
    if (cur.outstandingQuantity > 0.001) {
      cur.result = 'FAIL'
      cur.blocking = true
    } else if (Math.abs(cur.issuedQuantity - accounted) > 0.001) {
      cur.result = 'ATTENTION'
    } else {
      cur.result = 'PASS'
    }
    lines.push(cur)
  }

  if (lines.length === 0) {
    const parts = await Part.find({ tenantId, isActive: true }).limit(0)
    void parts
  }

  return lines
}
