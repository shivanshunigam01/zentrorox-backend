export type EInvoiceEligibilityInput = {
  tenantGstin?: string | null
  eInvoicingEnabled?: boolean
  mandatoryFrom?: Date | null
  turnoverThresholdInr?: number
  declaredAnnualTurnoverInr?: number | null
  invoiceDate: Date
  customerGstin?: string | null
  grandTotal: number
  b2bGstinRequired?: boolean
}

export type EInvoiceEligibilityResult = {
  eligible: boolean
  requirement: 'NOT_APPLICABLE' | 'NOT_REQUIRED' | 'REQUIRED'
  reasons: string[]
}

/** India e-invoice rules (simplified) — requires tax/compliance review before go-live. */
export function assessEInvoiceEligibility(input: EInvoiceEligibilityInput): EInvoiceEligibilityResult {
  const reasons: string[] = []
  if (!input.eInvoicingEnabled) {
    return { eligible: false, requirement: 'NOT_APPLICABLE', reasons: ['E-invoicing disabled for tenant'] }
  }
  if (!input.tenantGstin?.trim()) {
    reasons.push('Supplier GSTIN required for e-invoice')
    return { eligible: false, requirement: 'NOT_REQUIRED', reasons }
  }

  const mandatoryFrom = input.mandatoryFrom ?? new Date('2023-08-01T00:00:00+05:30')
  if (input.invoiceDate < mandatoryFrom) {
    return { eligible: false, requirement: 'NOT_REQUIRED', reasons: ['Invoice date before mandatory e-invoice effective date'] }
  }

  const threshold = input.turnoverThresholdInr ?? 500_000_000
  const turnover = input.declaredAnnualTurnoverInr
  if (turnover != null && turnover < threshold) {
    return {
      eligible: false,
      requirement: 'NOT_REQUIRED',
      reasons: [`Declared turnover below ₹${threshold} threshold`],
    }
  }

  if (input.b2bGstinRequired && !input.customerGstin?.trim()) {
    return {
      eligible: false,
      requirement: 'NOT_REQUIRED',
      reasons: ['B2C invoice — customer GSTIN not on file'],
    }
  }

  if (input.grandTotal < 0) {
    reasons.push('Invalid invoice total')
    return { eligible: false, requirement: 'NOT_REQUIRED', reasons }
  }

  return { eligible: true, requirement: 'REQUIRED', reasons: ['B2B issued tax invoice under configured mandate'] }
}
