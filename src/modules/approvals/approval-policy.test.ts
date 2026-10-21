import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateAdvanceRequirement } from './approval-policy.service.js'

describe('evaluateAdvanceRequirement', () => {
  const credit = {
    creditAllowed: true,
    creditLimit: 100000,
    postedOutstandingReceivables: 0,
    unbilledAuthorizedExposure: 0,
    unappliedCreditBalance: 0,
    reservedCredit: 0,
    availableCredit: 100000,
    overdueBalance: 0,
    provisional: true,
    note: 'test',
  }

  it('allows zero advance when policy permits', () => {
    const r = evaluateAdvanceRequirement(
      { allowZeroAdvance: true, minimumAdvanceType: 'NONE' },
      50000,
      0,
      { ...credit, creditAllowed: false },
    )
    assert.equal(r.satisfied, true)
  })

  it('blocks when fixed minimum not met', () => {
    const r = evaluateAdvanceRequirement(
      { allowZeroAdvance: false, minimumAdvanceType: 'FIXED', minimumAdvanceAmount: 5000 },
      50000,
      1000,
      { ...credit, creditAllowed: false },
    )
    assert.equal(r.satisfied, false)
    assert.equal(r.requiredAdvance, 5000)
  })

  it('allows credit customer when policy requires credit', () => {
    const r = evaluateAdvanceRequirement(
      { creditEligibilityRequired: true, minimumAdvanceType: 'FIXED', minimumAdvanceAmount: 10000 },
      50000,
      0,
      credit,
    )
    assert.equal(r.satisfied, true)
  })
})
