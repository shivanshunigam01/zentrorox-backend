import type { Types } from 'mongoose'
import { Estimate } from '../../models/index.js'
import { calculateLine, calculateEstimateTotals, type CalcLineOutput } from '../estimates/estimate-calculation.js'
import { requireTaxRuleForInvoiceLine } from '../tax/tax-resolution.js'
import { buildReconciliationSummary, type ReconciliationLine } from './invoice-reconciliation.service.js'

const PART_CATEGORIES = new Set(['PARTS', 'LUBRICANT', 'BATTERY', 'TYRE', 'ACCESSORY'])
const LABOUR_CATEGORIES = new Set(['LABOUR', 'DENTING_PAINTING', 'PICKUP', 'DROP', 'TOWING', 'OTHER'])

function currentRevision(doc: { revisions: Array<{ revisionNumber: number; items?: unknown[] }>; currentRevisionNumber: number }) {
  return doc.revisions.find((r) => r.revisionNumber === doc.currentRevisionNumber)
}

type DraftLine = Record<string, unknown>

async function buildLabourLines(
  tenantId: string,
  serviceVisitId: string,
  useIgst: boolean,
  jobCardId: Types.ObjectId,
  jobCardRevision: number,
): Promise<DraftLine[]> {
  const lines: DraftLine[] = []
  const estimates = await Estimate.find({
    tenantId,
    serviceVisitId,
    status: { $in: ['CUSTOMER_APPROVED', 'PARTIALLY_APPROVED'] },
  })
  for (const est of estimates) {
    const rev = currentRevision({
      revisions: est.revisions as Array<{ revisionNumber: number; items?: unknown[] }>,
      currentRevisionNumber: est.currentRevisionNumber,
    })
    for (const raw of rev?.items ?? []) {
      const item = raw as {
        lineId: string
        category: string
        description: string
        hsnSac?: string | null
        quantity?: number
        unitRate?: number
        discountAmount?: number
        customerApprovalStatus?: string
        partNumber?: string
      }
      if (PART_CATEGORIES.has(item.category)) continue
      if (!LABOUR_CATEGORIES.has(item.category) && item.category) continue
      if (item.customerApprovalStatus === 'REJECTED') continue
      if (est.estimateKind === 'PRIMARY' && item.customerApprovalStatus && item.customerApprovalStatus !== 'APPROVED' && est.status !== 'CUSTOMER_APPROVED') {
        continue
      }
      const taxRule = await requireTaxRuleForInvoiceLine(tenantId, item.category, item.hsnSac)
      const calc = calculateLine({
        lineId: item.lineId,
        category: item.category,
        quantity: item.quantity ?? 1,
        unitRate: item.unitRate ?? 0,
        discountAmount: item.discountAmount,
        useIgst,
        taxRule: {
          id: taxRule.id,
          gstPercent: taxRule.gstPercent,
          cgstPercent: taxRule.cgstPercent,
          sgstPercent: taxRule.sgstPercent,
          igstPercent: taxRule.igstPercent,
          taxInclusive: taxRule.taxInclusive,
        },
      })
      lines.push({
        sourceEstimateLineId: item.lineId,
        supplementaryEstimateLineId: est.estimateKind === 'SUPPLEMENTARY' ? item.lineId : undefined,
        jobCardId,
        jobCardRevision,
        category: item.category,
        description: est.estimateKind === 'SUPPLEMENTARY' ? `[Supplementary] ${item.description}` : item.description,
        hsnSac: item.hsnSac ?? undefined,
        quantity: item.quantity ?? 1,
        billableQuantity: item.quantity ?? 1,
        unitRate: item.unitRate ?? 0,
        approvedUnitSellingPrice: item.unitRate ?? 0,
        grossAmount: calc.grossAmount,
        discountAmount: item.discountAmount ?? 0,
        taxableAmount: calc.taxableAmount,
        cgstAmount: calc.cgstAmount,
        sgstAmount: calc.sgstAmount,
        igstAmount: calc.igstAmount,
        finalAmount: calc.finalAmount,
        taxRuleId: taxRule.id,
        reconciliationStatus: 'OK',
      })
    }
  }
  return lines
}

async function buildPartsLinesFromReconciliation(
  tenantId: string,
  useIgst: boolean,
  reconciliation: ReconciliationLine[],
): Promise<DraftLine[]> {
  const lines: DraftLine[] = []
  for (const row of reconciliation) {
    if (row.billableQuantity <= 0) continue
    const category = 'PARTS'
    const taxRule = await requireTaxRuleForInvoiceLine(tenantId, category, row.hsnSac)
    const unitRate = row.approvedUnitSellingPrice
    const calc = calculateLine({
      lineId: row.approvedEstimateLineId ?? row.partNumber,
      category,
      quantity: row.billableQuantity,
      unitRate,
      useIgst,
      taxRule: {
        id: taxRule.id,
        gstPercent: taxRule.gstPercent,
        cgstPercent: taxRule.cgstPercent,
        sgstPercent: taxRule.sgstPercent,
        igstPercent: taxRule.igstPercent,
        taxInclusive: taxRule.taxInclusive,
      },
    })
    lines.push({
      sourceEstimateLineId: row.approvedEstimateLineId,
      supplementaryEstimateLineId: row.supplementaryEstimateLineId,
      jobCardId: row.jobCardId,
      jobCardRevision: row.jobCardRevision,
      stockPartId: row.stockPartId,
      partNumber: row.partNumber,
      category,
      description: row.partName ?? row.description ?? row.partNumber,
      hsnSac: row.hsnSac ?? taxRule.hsnSac,
      quantity: row.billableQuantity,
      billableQuantity: row.billableQuantity,
      approvedQuantity: row.approvedQuantity,
      requestedQuantity: row.requestedQuantity,
      issuedQuantity: row.issuedQuantity,
      consumedQuantity: row.consumedQuantity,
      returnedQuantity: row.returnedQuantity,
      scrappedQuantity: row.scrapQuantity,
      outstandingQuantity: row.outstandingQuantity,
      approvedUnitSellingPrice: unitRate,
      unitRate,
      grossAmount: calc.grossAmount,
      discountAmount: 0,
      taxableAmount: calc.taxableAmount,
      cgstAmount: calc.cgstAmount,
      sgstAmount: calc.sgstAmount,
      igstAmount: calc.igstAmount,
      finalAmount: calc.finalAmount,
      taxRuleId: taxRule.id,
      reconciliationStatus: row.reconciliationStatus,
      varianceReason: row.varianceReason,
    })
  }
  return lines
}

export async function buildInvoiceDraftPayload(params: {
  tenantId: string
  serviceVisitId: string
  jobCardId: Types.ObjectId
  jobCardRevision: number
  useIgst: boolean
  reconciliationOverrides?: Record<string, { varianceReason?: string; authorizedException?: boolean }>
}) {
  const reconciliation = await buildReconciliationSummary(
    params.tenantId,
    params.serviceVisitId,
    params.jobCardId,
    params.reconciliationOverrides,
  )
  const labourLines = await buildLabourLines(
    params.tenantId,
    params.serviceVisitId,
    params.useIgst,
    params.jobCardId,
    params.jobCardRevision,
  )
  const partLines = await buildPartsLinesFromReconciliation(params.tenantId, params.useIgst, reconciliation.lines)
  const lines = [...labourLines, ...partLines]
  if (!lines.length) {
    throw new Error('No billable approved lines found')
  }

  const calcLines: CalcLineOutput[] = lines.map((l) => ({
    lineId: String(l.sourceEstimateLineId ?? l.partNumber),
    category: String(l.category),
    quantity: Number(l.quantity),
    unitRate: Number(l.unitRate),
    discountAmount: Number(l.discountAmount ?? 0),
    grossAmount: Number(l.grossAmount),
    taxableAmount: Number(l.taxableAmount),
    cgstAmount: Number(l.cgstAmount),
    sgstAmount: Number(l.sgstAmount),
    igstAmount: Number(l.igstAmount),
    finalAmount: Number(l.finalAmount),
    effectiveGstRate: 0,
    useIgst: params.useIgst,
  }))
  const totals = calculateEstimateTotals(calcLines)

  return { lines, totals, reconciliation }
}
