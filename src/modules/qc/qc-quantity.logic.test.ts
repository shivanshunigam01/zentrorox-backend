import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('quantity reconciliation math', () => {
  it('outstanding equals issued minus consumed returned and scrap', () => {
    const issued = 4
    const consumed = 3
    const returned = 1
    const scrap = 0
    const outstanding = Math.max(0, issued - consumed - returned - scrap)
    assert.equal(outstanding, 0)
  })
})
