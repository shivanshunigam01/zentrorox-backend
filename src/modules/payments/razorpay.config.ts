import Razorpay from 'razorpay'
import { env } from '../../config/env.js'
import { ValidationError } from '../../utils/errors.js'

export function assertRazorpayConfigured(): void {
  if (!env.RAZORPAY_KEY_ID?.trim() || !env.RAZORPAY_KEY_SECRET?.trim()) {
    throw new ValidationError('Razorpay is not configured on the server')
  }
}

export function getRazorpayClient(): Razorpay {
  assertRazorpayConfigured()
  const keyId = env.RAZORPAY_KEY_ID.trim()
  const mode = env.RAZORPAY_MODE
  if (mode === 'test' && keyId.startsWith('rzp_live_')) {
    throw new ValidationError('RAZORPAY_MODE=test but key id is live — fix environment configuration')
  }
  if (mode === 'live' && keyId.startsWith('rzp_test_')) {
    throw new ValidationError('RAZORPAY_MODE=live but key id is test — fix environment configuration')
  }
  if (env.NODE_ENV === 'production' && mode !== 'live') {
    throw new ValidationError('Production requires RAZORPAY_MODE=live with live keys')
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: env.RAZORPAY_KEY_SECRET.trim(),
  })
}

export function inrToPaise(amountInr: number): number {
  if (!Number.isFinite(amountInr) || amountInr <= 0) return 0
  return Math.round(amountInr * 100)
}
