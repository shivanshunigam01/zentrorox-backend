import {
  AdditionalWorkRequest,
  JobCard,
  JobWorkItem,
  PartsRequisition,
  WipRecord,
} from '../../models/index.js'

export type QcEligibilityResult = { eligible: boolean; reasons: string[] }

export async function assertEligibleForQc(tenantId: string, jobCardId: string): Promise<QcEligibilityResult> {
  const reasons: string[] = []
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId })
  if (!jc) return { eligible: false, reasons: ['Job card not found'] }

  if (!['READY_FOR_QC', 'QC_IN_PROGRESS', 'QC_FAILED', 'REWORK_IN_PROGRESS'].includes(jc.status)) {
    reasons.push(`Job card status must be ready for QC (current: ${jc.status})`)
  }

  const wip = await WipRecord.findOne({ tenantId, jobCardId: jc._id })
  if (!wip || !['READY_FOR_QC', 'WORK_COMPLETED'].includes(wip.status)) {
    reasons.push('WIP must be supervisor-verified and ready for QC')
  }

  const items = await JobWorkItem.find({ tenantId, jobCardId: jc._id, executionStatus: { $ne: 'CANCELLED' } })
  const incomplete = items.filter((i) => !['COMPLETED', 'VERIFIED'].includes(i.executionStatus ?? ''))
  if (incomplete.length) reasons.push('All authorized work items must be completed and verified')

  const unverified = items.filter((i) => i.qcRequired && i.executionStatus === 'COMPLETED')
  if (unverified.length) reasons.push('Supervisor verification pending on QC-required work items')

  const blockingAwr = await AdditionalWorkRequest.countDocuments({
    tenantId,
    jobCardId: jc._id,
    status: { $in: ['SUBMITTED', 'SUPERVISOR_REVIEW', 'SENT_TO_CUSTOMER', 'ESTIMATE_PREPARED'] },
  })
  if (blockingAwr > 0) reasons.push('Additional work approval pending')

  const openReq = await PartsRequisition.find({
    tenantId,
    jobCardId: jc._id,
    status: { $in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_ISSUED'] },
  }).lean()
  if (openReq.length) reasons.push('Open parts requisitions must be closed or dispositioned')

  return { eligible: reasons.length === 0, reasons }
}
