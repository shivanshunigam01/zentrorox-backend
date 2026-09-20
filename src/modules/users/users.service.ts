import { User, Role } from '../../models/index.js'
import type { Request } from 'express'

export async function listUsers(req: Request) {
  const users = await User.find({ tenantId: req.tenantId!, isActive: true })
    .populate('roleId', 'name code')
    .sort({ firstName: 1 })
    .lean()

  return users.map((u) => {
    const role = u.roleId as { name?: string; code?: string } | undefined
    return {
      id: u._id.toString(),
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
      role: role?.name ?? '—',
      roleCode: role?.code,
      isPlatformAdmin: u.isPlatformAdmin,
      lastLoginAt: u.lastLoginAt,
    }
  })
}

export async function listTechnicians(req: Request) {
  const roles = await Role.find({
    tenantId: req.tenantId!,
    code: { $in: ['TECHNICIAN', 'SERVICE_ADVISOR', 'WORKSHOP_MANAGER'] },
  }).lean()
  const roleIds = roles.map((r) => r._id)

  const users = await User.find({
    tenantId: req.tenantId!,
    isActive: true,
    roleId: { $in: roleIds },
  })
    .populate('roleId', 'name code')
    .sort({ firstName: 1 })
    .lean()

  return users.map((u) => {
    const role = u.roleId as { name?: string; code?: string } | undefined
    return {
      id: u._id.toString(),
      name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
      email: u.email,
      role: role?.name ?? '—',
      roleCode: role?.code,
    }
  })
}
