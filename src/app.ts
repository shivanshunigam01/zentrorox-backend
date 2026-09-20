import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'

import authRoutes from './modules/auth/auth.routes.js'
import dashboardRoutes from './modules/dashboard/dashboard.routes.js'
import customersRoutes from './modules/customers/customers.routes.js'
import vehiclesRoutes from './modules/vehicles/vehicles.routes.js'
import bookingsRoutes from './modules/bookings/bookings.routes.js'
import serviceVisitsRoutes from './modules/service-visits/service-visits.routes.js'
import uploadsRoutes from './modules/uploads/uploads.routes.js'
import mastersRoutes from './modules/masters/masters.routes.js'
import jobCardsRoutes from './modules/job-cards/job-cards.routes.js'
import partsRoutes from './modules/parts/parts.routes.js'
import baysRoutes from './modules/bays/bays.routes.js'
import branchesRoutes from './modules/branches/branches.routes.js'
import usersRoutes from './modules/users/users.routes.js'
import searchRoutes from './modules/search/search.routes.js'
import tenantRoutes from './modules/tenant/tenant.routes.js'

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id'],
  }))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  app.use(rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  }))

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'zentrosure-api',
      database: 'mongodb',
      timestamp: new Date().toISOString(),
    })
  })

  const api = express.Router()
  api.use('/auth', authRoutes)
  api.use('/dashboard', dashboardRoutes)
  api.use('/customers', customersRoutes)
  api.use('/vehicles', vehiclesRoutes)
  api.use('/bookings', bookingsRoutes)
  api.use('/service-visits', serviceVisitsRoutes)
  api.use('/uploads', uploadsRoutes)
  api.use('/masters', mastersRoutes)
  api.use('/job-cards', jobCardsRoutes)
  api.use('/parts', partsRoutes)
  api.use('/bays', baysRoutes)
  api.use('/branches', branchesRoutes)
  api.use('/users', usersRoutes)
  api.use('/search', searchRoutes)
  api.use('/tenant', tenantRoutes)

  app.use('/api/v1', api)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
