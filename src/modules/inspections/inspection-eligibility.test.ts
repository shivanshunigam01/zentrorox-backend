import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertEligibleForInspection } from './inspection-eligibility.js'

describe('assertEligibleForInspection', () => {
  it('requires completed receiving', () => {
    assert.throws(() => assertEligibleForInspection({ receivingStatus: 'IN_PROGRESS' }, { confirmationStatus: 'CONFIRMED', complaints: [{}] }))
  })

  it('allows completed receiving with confirmed VOC', () => {
    assertEligibleForInspection({ receivingStatus: 'COMPLETED' }, { confirmationStatus: 'CONFIRMED', complaints: [{}] })
  })

  it('blocks identity mismatch exception', () => {
    assert.throws(() =>
      assertEligibleForInspection(
        { receivingStatus: 'EXCEPTION', exceptionFlags: ['IDENTITY_MISMATCH'] },
        { confirmationStatus: 'CONFIRMED', complaints: [{}] },
      ),
    )
  })
})
