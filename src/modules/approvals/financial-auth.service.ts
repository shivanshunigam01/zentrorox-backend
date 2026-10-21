import type { Request } from 'express'
import {
  AdvancePayment,
  CustomerApproval,
  Estimate,
  FinancialAuthorization,
  ServiceVisit,
} from '../../models/index.js'
import { computeCreditExposure, evaluateAdvanceRequirement, loadActivePaymentPolicy } from './approval-policy.service.js'
import { createAuditLog } from '../../utils/audit.js'
import { ValidationError } from '../../utils/errors.js'

function currentRevision(doc: unknown) {
  const d = doc as { revisions: Array<Record<string, unknown>>; currentRevisionNumber: number }
  return d.revisions.find((r) => r.revisionNumber === d.currentRevisionNumber) as {
    revisionNumber: number
    frozen?: boolean
    totals?: { finalAmount?: number }
  } | undefined
}

export async function getFinancialAuthorization(req: Request, visitId: string) {
  let doc = await FinancialAuthorization.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
  }).lean()
  if (!doc) {
    doc = await evaluateFinancialAuthorization(req, visitId)
  }
  return doc
}

export async function evaluateFinancialAuthorization(req: Request, visitId: string) {
  const visit = await ServiceVisit.findOne({
    _id: visitId,
    tenantId: req.tenantId!,
  }).lean()
  if (!visit) throw new ValidationError('Visit not found')

  const estimate = await Estimate.findOne({ tenantId: req.tenantId!, serviceVisitId: visitId }).lean()
  const rev = estimate ? currentRevision(estimate) : null
  const approvedAmount = rev?.totals?.finalAmount ?? 0

  const approval = await CustomerApproval.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
    estimateRevisionNumber: estimate?.currentRevisionNumber,
    approvalStatus: { $in: ['FULLY_APPROVED', 'PARTIALLY_APPROVED'] },
  }).sort({ recordedAt: -1 }).lean()

  const scopeAmount = approval?.approvedAmount ?? approvedAmount

  const confirmedAdvance = await AdvancePayment.aggregate([
    {
      $match: {
        tenantId: visit.tenantId,
        serviceVisitId: visit._id,
        verificationStatus: 'CONFIRMED',
      },
    },
    { $group: { _id: null, total: { $sum: '$receivedAmount' } } },
  ])
  const confirmedAdvanceTotal = confirmedAdvance[0]?.total ?? 0

  const policy = await loadActivePaymentPolicy(req.tenantId!, visit.branchId)
  const credit = await computeCreditExposure(req.tenantId!, visit.customerId, scopeAmount)
  const existingFin = await FinancialAuthorization.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
  }).lean()

  let financialAuthStatus = 'NOT_EVALUATED'
  let paymentState = confirmedAdvanceTotal > 0 ? 'PARTIALLY_RECEIVED' : 'NO_ADVANCE'
  if (confirmedAdvanceTotal >= scopeAmount && scopeAmount > 0) paymentState = 'RECEIVED'

  const pendingVerify = await AdvancePayment.countDocuments({
    tenantId: req.tenantId!,
    serviceVisitId: visitId,
    verificationStatus: 'PENDING_VERIFICATION',
  })
  if (pendingVerify > 0) paymentState = 'PENDING_VERIFICATION'

  if (!approval) {
    financialAuthStatus = 'PENDING'
  } else {
    const policyInput = policy
      ? {
          allowZeroAdvance: policy.allowZeroAdvance,
          minimumAdvanceType: policy.minimumAdvanceType,
          minimumAdvancePercentage: policy.minimumAdvancePercentage ?? undefined,
          minimumAdvanceAmount: policy.minimumAdvanceAmount ?? undefined,
          creditEligibilityRequired: policy.creditEligibilityRequired,
        }
      : null
    const advanceCheck = evaluateAdvanceRequirement(policyInput, scopeAmount, confirmedAdvanceTotal, credit)
    if (advanceCheck.satisfied || credit.creditAllowed) {
      financialAuthStatus = 'AUTHORIZED'
    } else if (existingFin?.financialAuthStatus === 'EXCEPTION_APPROVED') {
      financialAuthStatus = 'EXCEPTION_APPROVED'
    } else {
      financialAuthStatus = 'BLOCKED'
    }
  }

  const remainingPlannedAmount = Math.max(0, scopeAmount - confirmedAdvanceTotal)

  const jobCardAuthorized =
    !!approval &&
    ['AUTHORIZED', 'EXCEPTION_APPROVED'].includes(financialAuthStatus) &&
    estimate &&
    ['CUSTOMER_APPROVED', 'PARTIALLY_APPROVED'].includes(estimate.status) &&
    rev?.frozen === true

  const payload = {
    tenantId: req.tenantId!,
    branchId: visit.branchId,
    serviceVisitId: visit._id,
    customerApprovalId: approval?._id,
    approvedEstimateRevisionId: estimate?.currentRevisionNumber,
    approvedScopeAmount: scopeAmount,
    paymentPolicyId: policy?._id,
    creditAssessment: credit,
    financialAuthStatus,
    paymentState,
    confirmedAdvanceTotal,
    remainingPlannedAmount,
    jobCardAuthorized,
    ...(jobCardAuthorized && {
      jobCardAuthorizedAt: new Date(),
      jobCardAuthorizedBy: req.user?.id,
    }),
  }

  const doc = await FinancialAuthorization.findOneAndUpdate(
    { tenantId: req.tenantId!, serviceVisitId: visitId },
    { $set: payload },
    { upsert: true, new: true },
  ).lean()

  return doc
}

export async function approveFinancialException(req: Request, visitId: string, body: { reason: string; expiresAt?: string }) {
  if (!req.user?.permissions.includes('financial_auth.exception')) {
    throw new ValidationError('Financial exception permission required')
  }
  const doc = await FinancialAuthorization.findOneAndUpdate(
    { tenantId: req.tenantId!, serviceVisitId: visitId },
    {
      $set: {
        financialAuthStatus: 'EXCEPTION_APPROVED',
        exceptionApprovedBy: req.user?.id,
        exceptionReason: body.reason,
        exceptionExpiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      },
    },
    { upsert: true, new: true },
  )
  await evaluateFinancialAuthorization(req, visitId)
  await createAuditLog({
    req,
    module: 'financial_auth',
    action: 'EXCEPTION_APPROVED',
    recordId: visitId,
    newValue: body,
  })
  return doc
}

export async function authorizeJobCard(req: Request, visitId: string) {
  const auth = await evaluateFinancialAuthorization(req, visitId)
  if (!auth?.jobCardAuthorized) {
    throw new ValidationError('Job card authorization requirements not met')
  }
  if (!req.user?.permissions.includes('approvals.job_card_authorize')) {
    throw new ValidationError('Workshop manager authorization permission required')
  }
  await FinancialAuthorization.updateOne(
    { tenantId: req.tenantId!, serviceVisitId: visitId },
    {
      $set: {
        jobCardAuthorized: true,
        jobCardAuthorizedAt: new Date(),
        jobCardAuthorizedBy: req.user?.id,
      },
    },
  )
  return { serviceVisitId: visitId, authorized: true }
}
