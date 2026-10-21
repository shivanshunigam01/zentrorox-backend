import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertBookingStatusTransition } from './booking-transitions.js'

describe('assertBookingStatusTransition', () => {
  it('allows AWAITING_GATE_IN to CHECKED_IN', () => {
    assertBookingStatusTransition('AWAITING_GATE_IN', 'CHECKED_IN')
  })

  it('rejects CHECKED_IN to CONFIRMED', () => {
    assert.throws(() => assertBookingStatusTransition('CHECKED_IN', 'CONFIRMED'))
  })

  it('allows no-op same status', () => {
    assertBookingStatusTransition('CONFIRMED', 'CONFIRMED')
  })
})
