import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assessEInvoiceEligibility } from './e-invoice-eligibility.js'

describe('assessEInvoiceEligibility', () => {
  it('returns NOT_APPLICABLE when disabled', () => {
    const r = assessEInvoiceEligibility({
      eInvoicingEnabled: false,
      invoiceDate: new Date('2024-01-01'),
      grandTotal: 1000,
    })
    assert.equal(r.requirement, 'NOT_APPLICABLE')
  })

  it('requires B2B GSTIN when configured', () => {
    const r = assessEInvoiceEligibility({
      eInvoicingEnabled: true,
      tenantGstin: '10AABCD1234E1Z5',
      invoiceDate: new Date('2024-06-01'),
      grandTotal: 5000,
      b2bGstinRequired: true,
      customerGstin: '10AAAAA0000A1Z5',
    })
    assert.equal(r.requirement, 'REQUIRED')
    assert.equal(r.eligible, true)
  })

  it('exempts B2C without customer GSTIN', () => {
    const r = assessEInvoiceEligibility({
      eInvoicingEnabled: true,
      tenantGstin: '10AABCD1234E1Z5',
      invoiceDate: new Date('2024-06-01'),
      grandTotal: 5000,
      b2bGstinRequired: true,
    })
    assert.equal(r.requirement, 'NOT_REQUIRED')
  })
})
