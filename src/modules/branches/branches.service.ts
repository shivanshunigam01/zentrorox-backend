import { Branch } from '../../models/index.js'
import type { Request } from 'express'

export async function listBranches(req: Request) {
  const branches = await Branch.find({ tenantId: req.tenantId!, isActive: true })
    .sort({ code: 1 })
    .lean()

  return branches.map((b) => ({
    id: b._id.toString(),
    code: b.code,
    name: b.name,
    city: b.city,
    state: b.state,
    phone: b.phone,
    address: b.address,
  }))
}
