import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  CLOUDINARY_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_FOLDER: z.string().default('zentrorox'),
  CLOUDINARY_UPLOAD_FOLDER: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  RAZORPAY_MODE: z.enum(['test', 'live']).default('test'),
  RAZORPAY_CURRENCY: z.string().default('INR'),
  RAZORPAY_PAYMENT_LINK_EXPIRY_HOURS: z.coerce.number().default(24),
  PUBLIC_APP_URL: z.string().optional().default('http://localhost:5173'),
})

const parsed = envSchema.parse(process.env)

if (parsed.NODE_ENV === 'production') {
  if (parsed.RAZORPAY_MODE === 'live') {
    if (!parsed.RAZORPAY_KEY_ID?.startsWith('rzp_live_')) {
      console.warn('⚠ Production RAZORPAY_MODE=live expects rzp_live_* key id')
    }
    if (!parsed.RAZORPAY_WEBHOOK_SECRET?.trim()) {
      console.warn('⚠ RAZORPAY_WEBHOOK_SECRET missing — webhooks will be rejected')
    }
  }
}

export const env = {
  ...parsed,
  CLOUDINARY_FOLDER: parsed.CLOUDINARY_UPLOAD_FOLDER ?? parsed.CLOUDINARY_FOLDER,
}
