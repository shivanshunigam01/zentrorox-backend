import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { inrToPaise } from './razorpay.config.js'
import { verifyWebhookSignature } from './razorpay-payment.service.js'

describe('inrToPaise', () => {
  it('converts INR safely', () => {
    assert.equal(inrToPaise(10.5), 1050)
    assert.equal(inrToPaise(0), 0)
  })
})

describe('verifyWebhookSignature', () => {
  it('validates HMAC signature', () => {
    const secret = 'test_webhook_secret'
    const body = Buffer.from('{"event":"payment.captured"}')
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
    process.env.RAZORPAY_WEBHOOK_SECRET = secret
    assert.equal(verifyWebhookSignature(body, sig), true)
    assert.equal(verifyWebhookSignature(body, 'bad'), false)
  })
})
