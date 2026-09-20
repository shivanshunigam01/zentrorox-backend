import type { ServiceStage } from './enums.js'

export interface AuthUser {
  id: string
  email: string
  tenantId: string | null
  roleId: string | null
  roleCode: string | null
  isPlatformAdmin: boolean
  permissions: string[]
  branchIds: string[]
  defaultBranchId: string | null
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      tenantId?: string
      branchId?: string
    }
  }
}

export interface JwtPayload {
  sub: string
  tenantId: string | null
  type: 'access' | 'refresh'
}

export const ALL_SERVICE_STAGES: ServiceStage[] = [
  'BOOKING', 'PICKUP', 'ARRIVAL', 'INVENTORY', 'VOC', 'INSPECTION',
  'DIAGNOSIS', 'ESTIMATE', 'APPROVAL', 'JOB_CARD', 'ASSIGNMENT', 'BAY',
  'WIP', 'QC', 'ROAD_TEST', 'INVOICE', 'PAYMENT', 'GATEPASS',
  'DELIVERY', 'FEEDBACK', 'PSF',
]
