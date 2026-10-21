import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeBillableQuantity } from './invoice-reconciliation.service.js'

describe('computeBillableQuantity', () => {
  it('bills consumed minus returns within approved scope', () => {
    const r = computeBillableQuantity(2, 2, 0)
    assert.equal(r.billable, 2)
    assert.equal(r.status, 'OK')
  })

  it('blocks over-consumption without authorization', () => {
    const r = computeBillableQuantity(1, 3, 0)
    assert.equal(r.status, 'BLOCKING')
    assert.equal(r.billable, 1)
  })

  it('allows authorized exception', () => {
    const r = computeBillableQuantity(1, 3, 0, true)
    assert.equal(r.billable, 3)
    assert.equal(r.status, 'VARIANCE')
  })

  it('excludes returned quantity from chargeable consumption', () => {
    const r = computeBillableQuantity(2, 3, 1)
    assert.equal(r.billable, 2)
    assert.equal(r.status, 'OK')
  })
})
