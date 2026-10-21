import type { Types } from 'mongoose'
import { CustomerCreditProfile, FinalInvoice, PaymentPolicy } from '../../models/index.js'
import { computeAvailableCreditLimit, sumUnappliedCreditBalance } from '../billing/ar-receivables.service.js'

export type CreditExposure = {
  creditAllowed: boolean
  creditLimit: number
  postedOutstandingReceivables: number
  unbilledAuthorizedExposure: number
  unappliedCreditBalance: number
  reservedCredit: number
  availableCredit: number
  overdueBalance: number
  provisional: boolean
  note: string
}

export async function loadActivePaymentPolicy(tenantId: Types.ObjectId | string, branchId?: Types.ObjectId | string) {
  const now = new Date()
  const policies = await PaymentPolicy.find({
    tenantId,
    active: true,
    $and: [
      { $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
      { $or: [{ effectiveTo: null }, { effectiveTo: { $gte: now } }] },
      ...(branchId ? [{ $or: [{ branchId }, { branchId: null }] }] : []),
    ],
  }).sort({ effectiveFrom: -1 }).lean()
  return policies[0] ?? null
}

export async function computeCreditExposure(
  tenantId: Types.ObjectId | string,
  customerId: Types.ObjectId | string,
  additionalExposure = 0,
): Promise<CreditExposure> {
  const profile = await CustomerCreditProfile.findOne({ tenantId, customerId }).lean()
  const creditAllowed = profile?.creditAllowed === true && profile?.status === 'ACTIVE' && !profile?.creditHold
  const creditLimit = profile?.creditLimit ?? 0
  const arAgg = await FinalInvoice.aggregate([
    {
      $match: {
        tenantId,
        customerId,
        status: 'ISSUED',
        balanceDue: { $gt: 0 },
      },
    },
    { $group: { _id: null, total: { $sum: '$balanceDue' } } },
  ])
  const postedOutstandingReceivables = arAgg[0]?.total ?? 0
  const unbilledAuthorizedExposure = additionalExposure
  const unappliedCreditBalance = await sumUnappliedCreditBalance(String(tenantId), String(customerId))
  const reservedCredit = 0
  const availableCredit = computeAvailableCreditLimit({
    creditAllowed: !!creditAllowed,
    creditLimit,
    postedOutstandingReceivables,
    unbilledAuthorizedExposure,
    unappliedCreditBalance,
  })

  return {
    creditAllowed: !!creditAllowed,
    creditLimit,
    postedOutstandingReceivables,
    unbilledAuthorizedExposure,
    unappliedCreditBalance,
    reservedCredit,
    availableCredit,
    overdueBalance: 0,
    provisional: false,
    note:
      profile?.provisionalExposureNote ??
      'AR uses issued invoice balanceDue (net of applied payments/credits). Unapplied credit notes tracked separately.',
  }
}

export function evaluateAdvanceRequirement(
  policy: {
    allowZeroAdvance?: boolean
    minimumAdvanceType?: string
    minimumAdvancePercentage?: number
    minimumAdvanceAmount?: number
    creditEligibilityRequired?: boolean
  } | null,
  approvedAmount: number,
  confirmedAdvance: number,
  credit: CreditExposure,
): { satisfied: boolean; requiredAdvance: number; reason?: string } {
  if (!policy || policy.allowZeroAdvance !== false) {
    if (confirmedAdvance > 0 || approvedAmount === 0) {
      return { satisfied: true, requiredAdvance: 0 }
    }
    if (policy?.creditEligibilityRequired && credit.creditAllowed && credit.availableCredit >= approvedAmount) {
      return { satisfied: true, requiredAdvance: 0 }
    }
    if (!policy || policy.minimumAdvanceType === 'NONE') {
      return { satisfied: true, requiredAdvance: 0 }
    }
  }

  let required = 0
  if (policy?.minimumAdvanceType === 'FIXED') {
    required = policy.minimumAdvanceAmount ?? 0
  } else if (policy?.minimumAdvanceType === 'PERCENTAGE') {
    required = Math.round((approvedAmount * (policy.minimumAdvancePercentage ?? 0)) / 100)
  }

  if (confirmedAdvance >= required) {
    return { satisfied: true, requiredAdvance: required }
  }
  if (policy?.creditEligibilityRequired && credit.creditAllowed && credit.availableCredit >= approvedAmount - confirmedAdvance) {
    return { satisfied: true, requiredAdvance: required }
  }
  return {
    satisfied: false,
    requiredAdvance: required,
    reason: `Minimum advance ₹${required} not met (confirmed ₹${confirmedAdvance}).`,
  }
}
