import { MasterData } from '../../models/index.js'
import { MASTER_CATEGORIES, MASTER_CATEGORY_KEYS, type MasterCategory } from '../../types/master-categories.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import type { Request } from 'express'

interface CreateMasterInput {
  category: MasterCategory
  code: string
  label: string
  parentCode?: string
  sortOrder?: number
  metadata?: Record<string, unknown>
}

export function listCategories() {
  return MASTER_CATEGORY_KEYS.map((key) => ({
    key,
    ...MASTER_CATEGORIES[key],
  }))
}

export async function listByCategory(req: Request, category: MasterCategory, parentCode?: string) {
  if (!MASTER_CATEGORY_KEYS.includes(category)) {
    throw new ValidationError(`Invalid master category: ${category}`)
  }

  const filter: Record<string, unknown> = {
    tenantId: req.tenantId!,
    category,
    isActive: true,
  }
  if (parentCode) filter.parentCode = parentCode

  const items = await MasterData.find(filter).sort({ sortOrder: 1, label: 1 }).lean()

  return items.map((item) => ({
    id: item._id.toString(),
    category: item.category,
    code: item.code,
    label: item.label,
    parentCode: item.parentCode,
    sortOrder: item.sortOrder,
  }))
}

export async function listAllGrouped(req: Request) {
  const items = await MasterData.find({ tenantId: req.tenantId!, isActive: true })
    .sort({ category: 1, sortOrder: 1, label: 1 })
    .lean()

  const grouped: Record<string, typeof items> = {}
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = []
    grouped[item.category].push(item)
  }

  return {
    categories: listCategories(),
    data: grouped,
  }
}

export async function createMaster(req: Request, input: CreateMasterInput) {
  if (!MASTER_CATEGORY_KEYS.includes(input.category)) {
    throw new ValidationError(`Invalid master category: ${input.category}`)
  }

  const code = input.code.toUpperCase().replace(/\s+/g, '_')

  const existing = await MasterData.findOne({
    tenantId: req.tenantId!,
    category: input.category,
    code,
  })
  if (existing) throw new ValidationError('Master code already exists in this category')

  const item = await MasterData.create({
    tenantId: req.tenantId!,
    category: input.category,
    code,
    label: input.label,
    parentCode: input.parentCode?.toUpperCase().replace(/\s+/g, '_'),
    sortOrder: input.sortOrder ?? 0,
    metadata: input.metadata,
  })

  return {
    id: item._id.toString(),
    category: item.category,
    code: item.code,
    label: item.label,
    parentCode: item.parentCode,
    sortOrder: item.sortOrder,
  }
}

export async function updateMaster(req: Request, id: string, data: Partial<CreateMasterInput>) {
  const item = await MasterData.findOne({ _id: id, tenantId: req.tenantId! })
  if (!item) throw new NotFoundError('Master record not found')

  if (data.label) item.label = data.label
  if (data.sortOrder !== undefined) item.sortOrder = data.sortOrder
  if (data.parentCode !== undefined) item.parentCode = data.parentCode
  if (data.metadata) item.metadata = data.metadata

  await item.save()
  return item
}

export async function deactivateMaster(req: Request, id: string) {
  const item = await MasterData.findOne({ _id: id, tenantId: req.tenantId! })
  if (!item) throw new NotFoundError('Master record not found')

  item.isActive = false
  await item.save()
  return { id: item._id.toString(), deactivated: true }
}

/** Dropdown options: { value, label } */
export async function getDropdownOptions(req: Request, category: MasterCategory, parentCode?: string) {
  const items = await listByCategory(req, category, parentCode)
  return items.map((item) => ({
    value: item.code,
    label: item.label,
    parentCode: item.parentCode,
  }))
}
