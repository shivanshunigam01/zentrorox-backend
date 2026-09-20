import { Vehicle, Customer, ServiceVisit } from '../../models/index.js'
import { NotFoundError } from '../../utils/errors.js'
import type { Request } from 'express'

interface ListParams {
  search?: string
  customerId?: string
  page?: number
  limit?: number
}

export async function listVehicles(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = {
    tenantId,
    isActive: true,
    ...(params.customerId && { customerId: params.customerId }),
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [
      { registrationNo: regex },
      { make: regex },
      { model: regex },
      { vin: regex },
    ]
  }

  const [items, total] = await Promise.all([
    Vehicle.find(filter)
      .populate('customerId', 'id name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Vehicle.countDocuments(filter),
  ])

  return {
    items: items.map((v) => ({
      ...v,
      id: v._id.toString(),
      customer: v.customerId,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getVehicle(req: Request, id: string) {
  const vehicle = await Vehicle.findOne({ _id: id, tenantId: req.tenantId! }).lean()
  if (!vehicle) throw new NotFoundError('Vehicle not found')

  const [customer, serviceVisits] = await Promise.all([
    Customer.findById(vehicle.customerId).lean(),
    ServiceVisit.find({ vehicleId: id }).sort({ createdAt: -1 }).limit(10).lean(),
  ])

  return {
    ...vehicle,
    id: vehicle._id.toString(),
    customer,
    serviceVisits: serviceVisits.map((sv) => ({ ...sv, id: sv._id.toString() })),
  }
}

export async function createVehicle(req: Request, data: {
  customerId: string
  registrationNo: string
  make: string
  model: string
  variant?: string
  vin?: string
  engineNo?: string
  fuelType?: string
  transmission?: string
  colour?: string
  manufacturingYear?: number
  odometer?: number
  imageUrl?: string
}) {
  const customer = await Customer.findOne({ _id: data.customerId, tenantId: req.tenantId! })
  if (!customer) throw new NotFoundError('Customer not found')

  const vehicle = await Vehicle.create({
    tenantId: req.tenantId!,
    customerId: data.customerId,
    registrationNo: data.registrationNo.toUpperCase(),
    make: data.make,
    model: data.model,
    variant: data.variant,
    vin: data.vin,
    engineNo: data.engineNo,
    fuelType: data.fuelType,
    transmission: data.transmission,
    colour: data.colour,
    manufacturingYear: data.manufacturingYear,
    odometer: data.odometer ?? 0,
    imageUrl: data.imageUrl,
    createdBy: req.user?.id,
  })

  return Vehicle.findById(vehicle._id).populate('customerId', 'name').lean()
}
