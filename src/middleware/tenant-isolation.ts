import type { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../utils/errors.js'

/**
 * Ensures all tenant-scoped queries use the authenticated user's tenant.
 * Controllers should always pass req.tenantId to service layer.
 */
export function enforceTenantScope(req: Request, _res: Response, next: NextFunction) {
  if (!req.tenantId) {
    return next(new ForbiddenError('Tenant isolation: missing tenant context'))
  }
  next()
}

export function tenantWhere(req: Request) {
  return { tenantId: req.tenantId! }
}
