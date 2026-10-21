import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { financialYearIndia } from './billing-eligibility.js'

describe('financialYearIndia', () => {
  it('uses April start', () => {
    assert.equal(financialYearIndia(new Date('2025-03-15')), '2024-25')
    assert.equal(financialYearIndia(new Date('2025-04-01')), '2025-26')
  })
})
