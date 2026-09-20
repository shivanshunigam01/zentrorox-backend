import { Customer, Vehicle } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import type { Request } from 'express'
import type { CustomerType } from '../../types/enums.js'

interface ListParams {
  search?: string
  type?: CustomerType
  page?: number
  limit?: number
}

export async function listCustomers(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = {
    tenantId,
    isActive: true,
    ...(params.type && { type: params.type }),
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [
      { name: regex },
      { mobile: regex },
      { code: regex },
      { email: regex },
    ]
  }

  const [items, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ])

  const itemsWithCounts = await Promise.all(
    items.map(async (c) => {
      const vehicleCount = await Vehicle.countDocuments({ customerId: c._id, isActive: true })
      return {
        id: c._id.toString(),
        code: c.code,
        name: c.name,
        mobile: c.mobile,
        email: c.email,
        type: c.type,
        city: c.city,
        vehicles: vehicleCount,
        creditLimit: c.creditLimit ?? null,
        createdAt: c.createdAt,
      }
    }),
  )

  return {
    items: itemsWithCounts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getCustomer(req: Request, id: string) {
  const customer = await Customer.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  if (!customer) throw new NotFoundError('Customer not found')

  const vehicles = await Vehicle.find({ customerId: id, isActive: true }).lean()

  return {
    ...customer,
    id: customer._id.toString(),
    vehicles: vehicles.map((v) => ({ ...v, id: v._id.toString() })),
  }
}

interface CreateCustomerInput {
  name: string
  mobile: string
  type?: CustomerType
  alternateMobile?: string
  email?: string
  gstin?: string
  address?: string
  city?: string
  state?: string
  pin?: string
  creditLimit?: number
  creditDays?: number
}

export async function createCustomer(req: Request, data: CreateCustomerInput) {
  const code = await generateDocumentNumber(req.tenantId!, 'CUSTOMER')

  const customer = await Customer.create({
    tenantId: req.tenantId!,
    code,
    type: data.type ?? 'INDIVIDUAL',
    name: data.name,
    mobile: data.mobile,
    alternateMobile: data.alternateMobile,
    email: data.email,
    gstin: data.gstin,
    address: data.address,
    city: data.city,
    state: data.state,
    pin: data.pin,
    creditLimit: data.creditLimit,
    creditDays: data.creditDays,
    createdBy: req.user?.id,
  })

  return {
    id: customer._id.toString(),
    code: customer.code,
    name: customer.name,
    mobile: customer.mobile,
    email: customer.email,
    type: customer.type,
    city: customer.city,
    vehicles: 0,
  }
}

export async function updateCustomer(req: Request, id: string, data: Partial<CreateCustomerInput>) {
  const existing = await Customer.findOne({ _id: id, tenantId: req.tenantId! })
  if (!existing) throw new NotFoundError('Customer not found')

  Object.assign(existing, data, { updatedBy: req.user?.id })
  await existing.save()
  return existing
}
