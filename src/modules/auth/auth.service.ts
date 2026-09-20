import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { Tenant, User, Role, Branch, RefreshToken } from '../../models/index.js'
import { env } from '../../config/env.js'
import { UnauthorizedError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import type { Request } from 'express'
import type { JwtPayload } from '../../types/express.js'

const MAX_FAILED_LOGINS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

interface LoginInput {
  tenantCode: string
  identifier: string
  password: string
  rememberMe?: boolean
}

function signAccessToken(userId: string, tenantId: string | null) {
  return jwt.sign(
    { sub: userId, tenantId, type: 'access' } satisfies JwtPayload,
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  )
}

function signRefreshToken(userId: string, tenantId: string | null) {
  return jwt.sign(
    { sub: userId, tenantId, type: 'refresh' } satisfies JwtPayload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  )
}

export async function login(input: LoginInput, req?: Request) {
  const tenant = await Tenant.findOne({ code: input.tenantCode.toUpperCase() }).lean()
  if (!tenant || tenant.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid organization code or account suspended')
  }

  const user = await User.findOne({
    tenantId: tenant._id,
    $or: [
      { email: input.identifier.toLowerCase() },
      { mobile: input.identifier },
      { userId: input.identifier },
    ],
  })

  if (!user) {
    throw new UnauthorizedError('Invalid credentials')
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new UnauthorizedError('Account temporarily locked. Try again later.')
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash)
  if (!valid) {
    const failedLogins = user.failedLogins + 1
    user.failedLogins = failedLogins
    user.lockedUntil = failedLogins >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_DURATION_MS) : undefined
    await user.save()
    throw new UnauthorizedError('Invalid credentials')
  }

  user.failedLogins = 0
  user.lockedUntil = undefined
  user.lastLoginAt = new Date()
  await user.save()

  const accessToken = signAccessToken(user._id.toString(), user.tenantId?.toString() ?? null)
  const refreshToken = signRefreshToken(user._id.toString(), user.tenantId?.toString() ?? null)

  const refreshExpires = new Date()
  refreshExpires.setDate(refreshExpires.getDate() + 7)

  await RefreshToken.create({
    userId: user._id,
    token: crypto.createHash('sha256').update(refreshToken).digest('hex'),
    expiresAt: refreshExpires,
  })

  await createAuditLog({
    tenantId: tenant._id.toString(),
    userId: user._id.toString(),
    module: 'auth',
    action: 'LOGIN',
    newValue: { email: user.email },
    req,
  })

  const role = user.roleId ? await Role.findById(user.roleId).lean() : null
  const branches = user.branchIds?.length
    ? await Branch.find({ _id: { $in: user.branchIds }, isActive: true }).lean()
    : []

  return {
    accessToken,
    refreshToken,
    user: {
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: role?.name ?? null,
      roleCode: role?.code ?? null,
      permissions: role?.permissionCodes ?? [],
      tenant: { id: tenant._id.toString(), code: tenant.code, name: tenant.name },
      branches: branches.map((b) => ({
        id: b._id.toString(),
        name: b.name,
        code: b.code,
      })),
      defaultBranchId: branches[0]?._id.toString() ?? null,
    },
  }
}

export async function refreshAccessToken(refreshToken: string) {
  let decoded: JwtPayload
  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload
  } catch {
    throw new UnauthorizedError('Invalid refresh token')
  }

  if (decoded.type !== 'refresh') {
    throw new UnauthorizedError('Invalid token type')
  }

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex')
  const stored = await RefreshToken.findOne({ token: tokenHash }).lean()

  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired or revoked')
  }

  const accessToken = signAccessToken(decoded.sub, decoded.tenantId)
  return { accessToken }
}

export async function logout(userId: string, req?: Request) {
  await RefreshToken.deleteMany({ userId })
  await createAuditLog({ userId, module: 'auth', action: 'LOGOUT', req })
}

export async function getMe(userId: string) {
  const user = await User.findById(userId).lean()
  if (!user) throw new ValidationError('User not found')

  const [tenant, role, branches] = await Promise.all([
    user.tenantId ? Tenant.findById(user.tenantId).lean() : null,
    user.roleId ? Role.findById(user.roleId).lean() : null,
    user.branchIds?.length
      ? Branch.find({ _id: { $in: user.branchIds } }).lean()
      : [],
  ])

  return {
    id: user._id.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: role?.name ?? null,
    roleCode: role?.code ?? null,
    permissions: role?.permissionCodes ?? [],
    tenant: tenant ? { id: tenant._id.toString(), code: tenant.code, name: tenant.name } : null,
    branches: branches.map((b) => ({
      id: b._id.toString(),
      name: b.name,
      code: b.code,
    })),
  }
}
