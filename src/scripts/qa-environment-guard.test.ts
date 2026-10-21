import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertQaDatabaseAllowed } from './qa-environment-guard.js'

describe('assertQaDatabaseAllowed', () => {
  it('blocks when ALLOW_QA_SEED is not true', () => {
    const prevUri = process.env.MONGODB_URI
    const prevAllow = process.env.ALLOW_QA_SEED
    process.env.MONGODB_URI = 'mongodb://localhost/zentrorox-qa'
    delete process.env.ALLOW_QA_SEED
    assert.throws(() => assertQaDatabaseAllowed(), /ALLOW_QA_SEED/)
    process.env.MONGODB_URI = prevUri
    if (prevAllow !== undefined) process.env.ALLOW_QA_SEED = prevAllow
  })

  it('blocks non-qa database names', () => {
    const prevUri = process.env.MONGODB_URI
    const prevAllow = process.env.ALLOW_QA_SEED
    process.env.ALLOW_QA_SEED = 'true'
    process.env.MONGODB_URI = 'mongodb://localhost/zentrosure'
    assert.throws(() => assertQaDatabaseAllowed(), /does not match/)
    process.env.MONGODB_URI = prevUri
    if (prevAllow !== undefined) process.env.ALLOW_QA_SEED = prevAllow
    else delete process.env.ALLOW_QA_SEED
  })

  it('allows qa-like database when flag set', () => {
    const prevUri = process.env.MONGODB_URI
    const prevAllow = process.env.ALLOW_QA_SEED
    const prevEnv = process.env.NODE_ENV
    process.env.ALLOW_QA_SEED = 'true'
    process.env.NODE_ENV = 'development'
    process.env.MONGODB_URI = 'mongodb://localhost/zentrorox-qa'
    const r = assertQaDatabaseAllowed()
    assert.equal(r.databaseName, 'zentrorox-qa')
    process.env.MONGODB_URI = prevUri
    if (prevAllow !== undefined) process.env.ALLOW_QA_SEED = prevAllow
    else delete process.env.ALLOW_QA_SEED
    if (prevEnv !== undefined) process.env.NODE_ENV = prevEnv
  })
})
