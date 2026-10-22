import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTenantCode } from './tenant-code.js'

describe('normalizeTenantCode', () => {
  it('uppercases and replaces spaces with hyphens', () => {
    assert.equal(normalizeTenantCode('demo motors'), 'DEMO-MOTORS')
    assert.equal(normalizeTenantCode('DEMO MOTORS'), 'DEMO-MOTORS')
  })
})
