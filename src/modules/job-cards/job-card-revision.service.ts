import type { Request } from 'express'
import {
  CustomerApproval,
  Estimate,
  JobCard,
  JobCardRevision,
  JobWorkItem,
} from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import * as estimatesService from '../estimates/estimates.service.js'

function currentRevision(estimate: { revisions: Array<{ revisionNumber: number }>; currentRevisionNumber: number }) {
  return estimate.revisions.find((r) => r.revisionNumber === estimate.currentRevisionNumber) ?? estimate.revisions[0]
}

export async function listRevisions(req: Request, jobCardId: string) {
  return JobCardRevision.find({ tenantId: req.tenantId!, jobCardId }).sort({ revisionNumber: 1 }).lean()
}

export async function createRevisionFromApproval(
  req: Request,
  jobCardId: string,
  body: { supplementaryApprovalId: string; supplementaryEstimateId: string },
  idempotencyKey?: string,
) {
  if (idempotencyKey) {
    const dup = await JobCardRevision.findOne({ tenantId: req.tenantId!, idempotencyKey }).lean()
    if (dup) return { revision: dup, duplicate: true }
  }

  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')

  const approval = await CustomerApproval.findOne({
    _id: body.supplementaryApprovalId,
    tenantId: req.tenantId!,
    serviceVisitId: jc.serviceVisitId,
  })
  if (!approval || !['FULLY_APPROVED', 'PARTIALLY_APPROVED'].includes(approval.approvalStatus)) {
    throw new ValidationError('Valid supplementary customer approval required')
  }

  const estimate = await Estimate.findOne({
    _id: body.supplementaryEstimateId,
    tenantId: req.tenantId!,
    estimateKind: 'SUPPLEMENTARY',
  })
  if (!estimate) throw new NotFoundError('Supplementary estimate not found')

  const rev = currentRevision(estimate)
  const handoff = await estimatesService.getJobCardHandoff(req, estimate._id.toString())
  const addedIds = []

  for (const item of handoff.approvedItems as Array<Record<string, unknown>>) {
    const wi = await JobWorkItem.create({
      tenantId: req.tenantId!,
      jobCardId: jc._id,
      estimateLineId: String((item as { lineId?: string; id?: string }).lineId ?? (item as { id?: string }).id),
      category: String(item.category ?? 'OTHER'),
      description: String(item.description ?? 'Supplementary work'),
      approvedQuantity: Number(item.quantity ?? 1),
      uom: String(item.uom ?? 'NOS'),
      standardLabourHours: Number(item.labourHours ?? 1),
      status: 'PENDING',
      executionStatus: 'NOT_STARTED',
      jobCardRevisionNumber: (jc.revisionNumber ?? 1) + 1,
      supplementaryEstimateLineId: String(item.lineId),
      chargeable: true,
    })
    addedIds.push(wi._id)
  }

  const prevRev = await JobCardRevision.findOne({ jobCardId: jc._id }).sort({ revisionNumber: -1 }).lean()
  const nextNum = (jc.revisionNumber ?? 1) + 1
  const addValue = (handoff.approvedItems as Array<{ finalAmount?: number }>).reduce((s, i) => s + (i.finalAmount ?? 0), 0)

  const revision = await JobCardRevision.create({
    tenantId: req.tenantId!,
    jobCardId: jc._id,
    revisionNumber: nextNum,
    previousRevisionId: prevRev?._id,
    source: 'SUPPLEMENTARY_APPROVAL',
    supplementaryEstimateId: estimate._id,
    supplementaryApprovalId: approval._id,
    addedWorkItemIds: addedIds,
    revisedAuthorizedValue: (jc.approvedValue ?? 0) + (jc.supplementaryApprovedValue ?? 0) + addValue,
    revisionReason: `Supplementary approval ${approval._id}`,
    createdBy: req.user?.id,
    idempotencyKey,
  })

  jc.revisionNumber = nextNum
  jc.currentRevisionId = revision._id
  jc.supplementaryApprovedValue = (jc.supplementaryApprovedValue ?? 0) + addValue
  jc.currentValue = (jc.approvedValue ?? 0) + (jc.supplementaryApprovedValue ?? 0)
  await jc.save()

  await createAuditLog({
    req,
    module: 'job_cards',
    action: 'REVISION_CREATED',
    recordId: jobCardId,
    newValue: { revisionNumber: nextNum, addedWorkItems: addedIds.length },
  })

  try {
    const { invalidateQcForJobCardRevision } = await import('../qc/qc.service.js')
    await invalidateQcForJobCardRevision(req.tenantId!, jobCardId)
  } catch {
    /* optional */
  }

  return { revision, duplicate: false }
}
