import { Tenant, Branch } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import type { Request } from 'express'

export async function getTenantProfile(req: Request) {
  const tenant = await Tenant.findById(req.tenantId!).lean()
  if (!tenant) throw new NotFoundError('Tenant not found')

  const branchId = req.branchId
  const branch = branchId
    ? await Branch.findOne({ _id: branchId, tenantId: tenant._id, isActive: true }).lean()
    : await Branch.findOne({ tenantId: tenant._id, isActive: true }).sort({ code: 1 }).lean()

  return {
    tenant: {
      id: tenant._id.toString(),
      code: tenant.code,
      name: tenant.name,
      legalName: tenant.legalName ?? tenant.name,
      gstin: tenant.gstin ?? '',
      email: tenant.email ?? '',
      phone: tenant.phone ?? '',
      address: tenant.address ?? '',
      city: tenant.city ?? '',
      state: tenant.state ?? '',
      pin: tenant.pin ?? '',
    },
    branch: branch
      ? {
          id: branch._id.toString(),
          code: branch.code,
          name: branch.name,
          address: branch.address ?? '',
          city: branch.city ?? '',
          state: branch.state ?? '',
          pin: branch.pin ?? '',
          phone: branch.phone ?? '',
        }
      : null,
  }
}
