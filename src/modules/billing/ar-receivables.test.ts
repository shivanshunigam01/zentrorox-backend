import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeAvailableCreditLimit,
  computeInvoiceBalanceDue,
  creditNoteStatusAfterApply,
} from './ar-receivables.service.js'

describe('computeInvoiceBalanceDue', () => {
  it('nets advance, payments, and applied credits', () => {
    assert.equal(
      computeInvoiceBalanceDue({
        grandTotal: 10000,
        advanceAllocated: 2000,
        paymentsReceived: 3000,
        creditsApplied: 1000,
      }),
      4000,
    )
  })

  it('never returns negative balance', () => {
    assert.equal(
      computeInvoiceBalanceDue({
        grandTotal: 1000,
        advanceAllocated: 500,
        paymentsReceived: 400,
        creditsApplied: 200,
      }),
      0,
    )
  })
})

describe('computeAvailableCreditLimit', () => {
  it('adds unapplied credit balance to available limit', () => {
    const avail = computeAvailableCreditLimit({
      creditAllowed: true,
      creditLimit: 100000,
      postedOutstandingReceivables: 40000,
      unbilledAuthorizedExposure: 10000,
      unappliedCreditBalance: 5000,
    })
    assert.equal(avail, 55000)
  })
})

describe('creditNoteStatusAfterApply', () => {
  it('marks fully applied', () => {
    assert.equal(creditNoteStatusAfterApply(1000, 1000), 'FULLY_APPLIED')
  })
  it('marks partial', () => {
    assert.equal(creditNoteStatusAfterApply(1000, 400), 'PARTIALLY_APPLIED')
  })
})
