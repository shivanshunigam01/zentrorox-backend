import { Part, StockBalance, Warehouse } from '../../models/index.js'
import type { Request } from 'express'

interface ListParams {
  search?: string
  category?: string
  page?: number
  limit?: number
}

export async function listParts(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 100)
  const skip = (page - 1) * limit

  const filter: Record<string, unknown> = { tenantId, isActive: true }
  if (params.category) filter.category = params.category
  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    filter.$or = [{ partNumber: regex }, { description: regex }, { brand: regex }]
  }

  const [items, total] = await Promise.all([
    Part.find(filter).sort({ partNumber: 1 }).skip(skip).limit(limit).lean(),
    Part.countDocuments(filter),
  ])

  return {
    items: items.map((p) => ({
      id: p._id.toString(),
      partNumber: p.partNumber,
      description: p.description,
      category: p.category,
      brand: p.brand,
      uom: p.uom,
      mrp: p.mrp,
      gstPercent: p.gstPercent,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function listStock(req: Request, params: ListParams) {
  const tenantId = req.tenantId!
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 50, 200)
  const skip = (page - 1) * limit

  const partFilter: Record<string, unknown> = { tenantId, isActive: true }
  if (params.search) {
    const regex = new RegExp(params.search, 'i')
    partFilter.$or = [{ partNumber: regex }, { description: regex }]
  }

  const parts = await Part.find(partFilter).select('_id partNumber description category brand mrp').lean()
  const partIds = parts.map((p) => p._id)
  const partMap = new Map(parts.map((p) => [p._id.toString(), p]))

  const stockRows = await StockBalance.find({
    tenantId,
    partId: { $in: partIds },
  })
    .populate('warehouseId', 'name code')
    .skip(skip)
    .limit(limit)
    .lean()

  const total = await StockBalance.countDocuments({ tenantId, partId: { $in: partIds } })

  return {
    items: stockRows.map((s) => {
      const part = partMap.get(s.partId.toString())
      const warehouse = s.warehouseId as { name?: string; code?: string } | undefined
      return {
        id: s._id.toString(),
        partNumber: part?.partNumber ?? '—',
        description: part?.description ?? '—',
        category: part?.category,
        brand: part?.brand,
        mrp: part?.mrp,
        warehouse: warehouse?.name ?? '—',
        available: s.available,
        reserved: s.reserved,
        reorderLevel: s.reorderLevel,
        lowStock: s.available <= (s.reorderLevel ?? 0),
      }
    }),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  }
}

export async function getPartsDashboard(req: Request) {
  const tenantId = req.tenantId!

  const [totalParts, warehouses, lowStockCount, stockValueAgg] = await Promise.all([
    Part.countDocuments({ tenantId, isActive: true }),
    Warehouse.countDocuments({ tenantId, isActive: true }),
    StockBalance.countDocuments({
      tenantId,
      $expr: { $lte: ['$available', '$reorderLevel'] },
    }),
    StockBalance.aggregate([
      { $match: { tenantId } },
      {
        $lookup: {
          from: 'parts',
          localField: 'partId',
          foreignField: '_id',
          as: 'part',
        },
      },
      { $unwind: '$part' },
      {
        $group: {
          _id: null,
          value: { $sum: { $multiply: ['$available', { $ifNull: ['$part.mrp', 0] }] } },
        },
      },
    ]),
  ])

  return {
    totalParts,
    warehouses,
    lowStockCount,
    stockValue: stockValueAgg[0]?.value ?? 0,
  }
}
