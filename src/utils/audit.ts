import { AuditLog } from '../models/index.js'
import type { Request } from 'express'

interface AuditParams {
  tenantId?: string | null
  branchId?: string | null
  userId?: string | null
  module: string
  recordId?: string
  action: string
  oldValue?: unknown
  newValue?: unknown
  req?: Request
}

export async function createAuditLog(params: AuditParams) {
  try {
    await AuditLog.create({
      tenantId: params.tenantId ?? undefined,
      branchId: params.branchId ?? undefined,
      userId: params.userId ?? undefined,
      module: params.module,
      recordId: params.recordId,
      action: params.action,
      oldValue: params.oldValue ?? undefined,
      newValue: params.newValue ?? undefined,
      ipAddress: params.req?.ip,
      userAgent: params.req?.get('user-agent') ?? undefined,
    })
  } catch {
    // Audit failures should not break business transactions
  }
}
