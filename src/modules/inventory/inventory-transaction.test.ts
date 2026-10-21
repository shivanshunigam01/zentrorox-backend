import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveOnHand, sellableAvailable } from './inventory-transaction.service.js'

describe('inventory quantities', () => {
  it('computes sellable from onHand minus reserved', () => {
    assert.equal(sellableAvailable({ onHand: 10, reserved: 3 }), 7)
  })

  it('falls back to available+reserved when onHand unset', () => {
    assert.equal(effectiveOnHand({ available: 8, reserved: 2 }), 10)
    assert.equal(sellableAvailable({ available: 8, reserved: 2 }), 8)
  })
})
