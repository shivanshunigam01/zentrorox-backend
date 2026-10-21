import { CreditNote } from '../../models/index.js'
import { roundMoney } from '../estimates/estimate-calculation.js'

/** Pure balance formula — applied credits reduce balance alongside payments and advances. */
export function computeInvoiceBalanceDue(input: {
  grandTotal: number
  advanceAllocated?: number
  paymentsReceived?: number
  creditsApplied?: number
}): number {
  const total = input.grandTotal ?? 0
  const advance = input.advanceAllocated ?? 0
  const payments = input.paymentsReceived ?? 0
  const credits = input.creditsApplied ?? 0
  return roundMoney(Math.max(0, total - advance - payments - credits))
}

export function computeAvailableCreditLimit(input: {
  creditAllowed: boolean
  creditLimit: number
  postedOutstandingReceivables: number
  unbilledAuthorizedExposure: number
  unappliedCreditBalance: number
}): number {
  if (!input.creditAllowed) return 0
  const raw =
    input.creditLimit -
    input.postedOutstandingReceivables -
    input.unbilledAuthorizedExposure +
    Math.max(0, input.unappliedCreditBalance)
  return roundMoney(Math.max(0, raw))
}

export async function sumUnappliedCreditBalance(tenantId: string, customerId: string): Promise<number> {
  const notes = await CreditNote.find({
    tenantId,
    customerId,
    status: { $in: ['ISSUED', 'PARTIALLY_APPLIED'] },
    amountRemaining: { $gt: 0 },
  }).lean()
  return roundMoney(notes.reduce((s, n) => s + (n.amountRemaining ?? 0), 0))
}

export function creditNoteStatusAfterApply(
  grandTotal: number,
  amountApplied: number,
): 'ISSUED' | 'PARTIALLY_APPLIED' | 'FULLY_APPLIED' {
  if (amountApplied <= 0) return 'ISSUED'
  if (amountApplied >= grandTotal - 0.01) return 'FULLY_APPLIED'
  return 'PARTIALLY_APPLIED'
}
