import type { Types } from 'mongoose'
import { Estimate, JobCard, Part } from '../../models/index.js'
import { buildQuantitySnapshots, type QuantityLineSnapshot } from '../qc/qc-quantity.js'
import { ValidationError } from '../../utils/errors.js'

const PART_CATEGORIES = new Set(['PARTS', 'LUBRICANT', 'BATTERY', 'TYRE', 'ACCESSORY'])

export type ReconciliationLine = QuantityLineSnapshot & {
  partName?: string
  stockPartId?: string
  jobCardId: string
  jobCardRevision: number
  approvedEstimateLineId?: string
  supplementaryEstimateLineId?: string
  approvedUnitSellingPrice: number
  hsnSac?: string | null
  billableQuantity: number
  reconciliationStatus: 'OK' | 'VARIANCE' | 'BLOCKING'
  varianceReason?: string
  authorizedException?: boolean
}

export type ReconciliationSummary = {
  lines: ReconciliationLine[]
  hasBlocking: boolean
  blockingReasons: string[]
}

type EstimatePartLine = {
  lineId: string
  estimateId: string
  supplementary: boolean
  partNumber?: string
  description: string
  category: string
  quantity: number
  unitRate: number
  discountAmount?: number
  hsnSac?: string | null
  customerApprovalStatus?: string
}

function currentRevision(doc: { revisions: Array<{ revisionNumber: number; items?: unknown[] }>; currentRevisionNumber: number }) {
  return doc.revisions.find((r) => r.revisionNumber === doc.currentRevisionNumber)
}

async function loadApprovedPartEstimateLines(tenantId: string, serviceVisitId: string): Promise<EstimatePartLine[]> {
  const estimates = await Estimate.find({
    tenantId,
    serviceVisitId,
    status: { $in: ['CUSTOMER_APPROVED', 'PARTIALLY_APPROVED'] },
  }).lean()
  const out: EstimatePartLine[] = []
  for (const est of estimates) {
    const rev = currentRevision(est as { revisions: Array<{ revisionNumber: number; items?: unknown[] }>; currentRevisionNumber: number })
    for (const raw of rev?.items ?? []) {
      const item = raw as EstimatePartLine & { partNumber?: string }
      if (!PART_CATEGORIES.has(item.category)) continue
      if (item.customerApprovalStatus === 'REJECTED') continue
      if (est.estimateKind === 'PRIMARY' && item.customerApprovalStatus && item.customerApprovalStatus !== 'APPROVED' && est.status !== 'CUSTOMER_APPROVED') {
        continue
      }
      out.push({
        lineId: item.lineId,
        estimateId: est._id.toString(),
        supplementary: est.estimateKind === 'SUPPLEMENTARY',
        partNumber: item.partNumber,
        description: item.description,
        category: item.category,
        quantity: item.quantity ?? 0,
        unitRate: item.unitRate ?? 0,
        discountAmount: item.discountAmount,
        hsnSac: item.hsnSac,
        customerApprovalStatus: item.customerApprovalStatus,
      })
    }
  }
  return out
}

function matchEstimateLine(estimateLines: EstimatePartLine[], snap: QuantityLineSnapshot) {
  const pn = (snap.partNumber ?? '').toUpperCase()
  return estimateLines.find((e) => (e.partNumber ?? '').toUpperCase() === pn && pn.length > 0)
}

export function computeBillableQuantity(
  approvedQty: number,
  consumedQty: number,
  returnedQty: number,
  authorizedException?: boolean,
): { billable: number; status: ReconciliationLine['reconciliationStatus']; reason?: string } {
  const chargeableConsumption = Math.max(0, consumedQty - returnedQty)
  if (chargeableConsumption <= approvedQty + 0.001) {
    return { billable: chargeableConsumption, status: chargeableConsumption < approvedQty ? 'VARIANCE' : 'OK' }
  }
  if (authorizedException) {
    return {
      billable: chargeableConsumption,
      status: 'VARIANCE',
      reason: 'Authorized exception for consumption above approved scope',
    }
  }
  return {
    billable: approvedQty,
    status: 'BLOCKING',
    reason: `Consumed ${chargeableConsumption} exceeds approved ${approvedQty} without authorization`,
  }
}

export async function buildReconciliationSummary(
  tenantId: string,
  serviceVisitId: string,
  jobCardId: Types.ObjectId | string,
  overrides?: Record<string, { varianceReason?: string; authorizedException?: boolean }>,
): Promise<ReconciliationSummary> {
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId }).lean()
  if (!jc) throw new ValidationError('Job card required for reconciliation')

  const snapshots = await buildQuantitySnapshots(tenantId, jobCardId.toString())
  const estimateLines = await loadApprovedPartEstimateLines(tenantId, serviceVisitId.toString())
  const blockingReasons: string[] = []
  const lines: ReconciliationLine[] = []

  for (const snap of snapshots) {
    const key = `${snap.partId ?? snap.partNumber}-${snap.jobWorkItemId ?? 'na'}`
    const override = overrides?.[key]
    const est = matchEstimateLine(estimateLines, snap)
    const approvedQty = est?.quantity ?? snap.approvedQuantity ?? 0
    const unitRate = est?.unitRate ?? 0
    if (!est && snap.consumedQuantity > 0) {
      blockingReasons.push(`Part ${snap.partNumber} consumed without approved estimate line`)
    }
    const partDoc = snap.partId ? await Part.findById(snap.partId).lean() : null
    const { billable, status, reason } = computeBillableQuantity(
      approvedQty,
      snap.consumedQuantity,
      snap.returnedQuantity,
      override?.authorizedException,
    )
    let reconciliationStatus = snap.blocking ? 'BLOCKING' : status
    let varianceReason = reason ?? override?.varianceReason
    if (snap.blocking) {
      reconciliationStatus = 'BLOCKING'
      varianceReason = varianceReason ?? `Outstanding inventory ${snap.outstandingQuantity} not reconciled`
      blockingReasons.push(`${snap.partNumber}: ${varianceReason}`)
    } else if (reconciliationStatus === 'BLOCKING' && reason) {
      blockingReasons.push(`${snap.partNumber}: ${reason}`)
    }

    lines.push({
      ...snap,
      partName: partDoc?.description ?? snap.description,
      stockPartId: snap.partId,
      jobCardId: jobCardId.toString(),
      jobCardRevision: jc.revisionNumber ?? 1,
      approvedEstimateLineId: est && !est.supplementary ? est.lineId : undefined,
      supplementaryEstimateLineId: est?.supplementary ? est.lineId : undefined,
      approvedUnitSellingPrice: unitRate,
      hsnSac: est?.hsnSac,
      billableQuantity: billable,
      reconciliationStatus,
      varianceReason,
      authorizedException: override?.authorizedException,
    })
  }

  return { lines, hasBlocking: blockingReasons.length > 0, blockingReasons }
}

export async function assertReconciliationAllowsIssue(summary: ReconciliationSummary) {
  if (summary.hasBlocking) {
    throw new ValidationError(`Parts reconciliation blocking invoice: ${summary.blockingReasons.join('; ')}`)
  }
}
