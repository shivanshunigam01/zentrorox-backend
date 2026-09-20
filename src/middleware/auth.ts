import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { User, Role } from '../models/index.js'
import { UnauthorizedError, ForbiddenError } from '../utils/errors.js'
import type { AuthUser, JwtPayload } from '../types/express.js'

async function loadUser(userId: string): Promise<AuthUser | null> {
  const user = await User.findById(userId).lean()
  if (!user || !user.isActive) return null

  const role = user.roleId ? await Role.findById(user.roleId).lean() : null
  const permissions = role?.permissionCodes ?? []
  const branchIds = (user.branchIds ?? []).map((id) => id.toString())

  return {
    id: user._id.toString(),
    email: user.email,
    tenantId: user.tenantId?.toString() ?? null,
    roleId: user.roleId?.toString() ?? null,
    roleCode: role?.code ?? null,
    isPlatformAdmin: user.isPlatformAdmin,
    permissions,
    branchIds,
    defaultBranchId: branchIds[0] ?? null,
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header')
    }

    const token = header.slice(7)
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload

    if (decoded.type !== 'access') {
      throw new UnauthorizedError('Invalid token type')
    }

    const user = await loadUser(decoded.sub)
    if (!user) {
      throw new UnauthorizedError('User not found or inactive')
    }

    req.user = user
    req.tenantId = user.tenantId ?? undefined
    req.branchId = (req.headers['x-branch-id'] as string) || user.defaultBranchId || undefined

    next()
  } catch (err) {
    if (err instanceof UnauthorizedError) return next(err)
    next(new UnauthorizedError('Invalid or expired token'))
  }
}

export function requirePermission(...required: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError())
    if (req.user.isPlatformAdmin) return next()

    const hasAll = required.every(
      (p) => req.user!.permissions.includes(p) || req.user!.permissions.includes('*'),
    )

    if (!hasAll) {
      return next(new ForbiddenError('Insufficient permissions'))
    }

    next()
  }
}

export function requireTenant(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.tenantId) {
    return next(new ForbiddenError('Tenant context required'))
  }
  req.tenantId = req.user.tenantId
  next()
}
