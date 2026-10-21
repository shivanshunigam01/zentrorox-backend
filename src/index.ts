import { createApp } from './app.js'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from './lib/mongoose.js'
import { configureCloudinary, isCloudinaryConfigured } from './lib/cloudinary.js'

const app = createApp()

function warnProductionConfig() {
  if (env.NODE_ENV !== 'production') return
  const weak = (s: string) => s.includes('change-me') || s.length < 48
  if (weak(env.JWT_ACCESS_SECRET) || weak(env.JWT_REFRESH_SECRET)) {
    console.error('✗ Production requires strong JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (min 48 chars, not defaults).')
    process.exit(1)
  }
  if (!process.env.SMTP_USER && !process.env.SENDGRID_API_KEY) {
    console.warn('⚠ No SMTP or SendGrid configured — outbound email will report NOT_CONFIGURED.')
  }
}

async function main() {
  try {
    warnProductionConfig()
    await connectDatabase()

    if (isCloudinaryConfigured()) {
      configureCloudinary()
      console.log('✓ Cloudinary configured')
    } else {
      console.log('⚠ Cloudinary not configured — image uploads disabled until env vars are set')
    }

    app.listen(env.PORT, () => {
      console.log(`✓ ZentroSure API running on http://localhost:${env.PORT}`)
      console.log(`  Health:  http://localhost:${env.PORT}/health`)
      console.log(`  API:     http://localhost:${env.PORT}/api/v1`)
      console.log(`  Uploads: http://localhost:${env.PORT}/api/v1/uploads/image`)
    })
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

main()

process.on('SIGINT', async () => {
  await disconnectDatabase()
  process.exit(0)
})
