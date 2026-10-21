import {
  CustomerApproval,
  Estimate,
  FinancialAuthorization,
  JobCard,
  ServiceVisit,
} from '../../models/index.js'
import { ValidationError } from '../../utils/errors.js'

function currentRevision(doc: unknown) {
  const d = doc as { revisions: Array<Record<string, unknown>>; currentRevisionNumber: number }
  return d.revisions.find((r) => r.revisionNumber === d.currentRevisionNumber) as {
    frozen?: boolean
    items?: Array<{ lineId: string; customerApprovalStatus?: string; finalAmount?: number }>
  } | undefined
}

export type JobCardEligibility = {
  eligible: boolean
  reasons: string[]
  visitId: string
  estimateId?: string
  revisionNumber?: number
  approvedLineCount: number
  financialAuthStatus?: string
  customerApprovalId?: string
}

export async function assertEligibleForJobCard(
  tenantId: string,
  visitId: string,
  branchId?: string,
): Promise<JobCardEligibility> {
  const reasons: string[] = []
  const visit = await ServiceVisit.findOne({
    _id: visitId,
    tenantId,
    ...(branchId && { branchId }),
  }).lean()
  if (!visit) throw new ValidationError('Service visit not found')

  const existing = await JobCard.findOne({ tenantId, serviceVisitId: visitId }).lean()
  if (existing && existing.status !== 'CANCELLED') {
    reasons.push('Active job card already exists for this visit')
  }

  const estimate = await Estimate.findOne({ tenantId, serviceVisitId: visitId }).lean()
  if (!estimate) reasons.push('No estimate on visit')
  const rev = estimate ? currentRevision(estimate) : undefined
  if (!rev?.frozen) reasons.push('Estimate revision must be issued (frozen)')

  if (estimate && !['CUSTOMER_APPROVED', 'PARTIALLY_APPROVED'].includes(estimate.status)) {
    reasons.push('Customer approval required on current estimate')
  }

  const approval = await CustomerApproval.findOne({
    tenantId,
    serviceVisitId: visitId,
    estimateRevisionNumber: estimate?.currentRevisionNumber,
    approvalStatus: { $in: ['FULLY_APPROVED', 'PARTIALLY_APPROVED'] },
  }).sort({ recordedAt: -1 }).lean()
  if (!approval) reasons.push('Canonical customer approval record missing for current revision')

  const fin = await FinancialAuthorization.findOne({ tenantId, serviceVisitId: visitId }).lean()
  const finOk = fin && ['AUTHORIZED', 'EXCEPTION_APPROVED'].includes(fin.financialAuthStatus)
  if (!finOk) reasons.push('Financial authorization not satisfied (advance/credit/policy)')

  const approvedLines = (rev?.items ?? []).filter(
    (i) => i.customerApprovalStatus === 'APPROVED' || estimate?.status === 'CUSTOMER_APPROVED',
  )
  if (approvedLines.length === 0) reasons.push('No approved work lines to execute')

  return {
    eligible: reasons.length === 0,
    reasons,
    visitId,
    estimateId: estimate?._id.toString(),
    revisionNumber: estimate?.currentRevisionNumber,
    approvedLineCount: approvedLines.length,
    financialAuthStatus: fin?.financialAuthStatus,
    customerApprovalId: approval?._id.toString(),
  }
}
