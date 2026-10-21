import type { Request, Response, NextFunction } from 'express'
import { handleRazorpayWebhook } from './razorpay-payment.service.js'

export async function razorpayWebhookHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const raw = req.body as Buffer
    const signature = req.headers['x-razorpay-signature'] as string | undefined
    const result = await handleRazorpayWebhook(raw, signature)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
}
