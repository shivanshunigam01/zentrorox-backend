import { Router } from 'express'
import { z } from 'zod'
import * as authService from './auth.service.js'
import { authenticate } from '../../middleware/auth.js'
import { ValidationError } from '../../utils/errors.js'

const router = Router()

const loginSchema = z.object({
  tenantCode: z.string().min(1),
  identifier: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
})

router.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body)
    const result = await authService.login(input, req)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body)
    const result = await authService.refreshAccessToken(refreshToken)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await authService.logout(req.user!.id, req)
    res.json({ success: true, message: 'Logged out successfully' })
  } catch (err) {
    next(err)
  }
})

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user!.id)
    res.json({ success: true, data: user })
  } catch (err) {
    next(err)
  }
})

export default router
