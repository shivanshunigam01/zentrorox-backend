import { MasterData } from '../../models/index.js'
import type { Types } from 'mongoose'

const DEFAULT_ITEMS = [
  { category: 'Engine', code: 'ENG_OIL', label: 'Engine oil level & condition', method: 'Visual', sortOrder: 1 },
  { category: 'Cooling', code: 'COOL_LEVEL', label: 'Coolant level', method: 'Visual', sortOrder: 2 },
  { category: 'Braking', code: 'BRK_PAD', label: 'Brake pad thickness (visual)', method: 'Visual', sortOrder: 3 },
  { category: 'Tyres / Wheels', code: 'TYRE_WEAR', label: 'Tyre tread & damage', method: 'Visual', sortOrder: 4 },
  { category: 'Electrical', code: 'ELEC_WARN', label: 'Dashboard warning lamps', method: 'KOEO test', sortOrder: 5 },
  { category: 'Battery', code: 'BAT_TERM', label: 'Battery terminals & mounting', method: 'Visual', sortOrder: 6 },
  { category: 'Fluid Leakage', code: 'LEAK_UC', label: 'Undercarriage fluid leaks', method: 'Visual', sortOrder: 7 },
  { category: 'Safety Systems', code: 'SAF_BELT', label: 'Seat belts & SRS indicators', method: 'Functional', sortOrder: 8 },
]

export async function buildChecklistSnapshot(tenantId: string, vehicleCategory?: string) {
  const query: Record<string, unknown> = {
    tenantId,
    category: { $in: ['INSPECTION_ITEM', 'INSPECTION_CATEGORY'] },
    isActive: true,
  }
  const masters = await MasterData.find({
    tenantId,
    category: 'INSPECTION_ITEM',
    isActive: true,
  }).sort({ sortOrder: 1, label: 1 }).lean()

  const filtered = vehicleCategory
    ? masters.filter((m) => {
        const cats = (m.metadata as { vehicleCategories?: string[] } | undefined)?.vehicleCategories
        return !cats?.length || cats.includes(vehicleCategory)
      })
    : masters

  const source = filtered.length ? filtered : null

  if (source) {
    return source.map((m) => ({
      masterItemId: m._id.toString(),
      category: m.parentCode ?? 'General',
      code: m.code,
      label: m.label,
      method: (m.metadata as { method?: string } | undefined)?.method ?? 'Visual',
      expectedStandard: (m.metadata as { expectedStandard?: string } | undefined)?.expectedStandard,
      inputType: (m.metadata as { inputType?: string } | undefined)?.inputType ?? 'dropdown',
      sortOrder: m.sortOrder ?? 0,
    }))
  }

  return DEFAULT_ITEMS.map((item) => ({
    masterItemId: undefined,
    category: item.category,
    code: item.code,
    label: item.label,
    method: item.method,
    inputType: 'dropdown',
    sortOrder: item.sortOrder,
  }))
}

export function initChecklistResponses(snapshot: Array<{ _id?: Types.ObjectId }>) {
  return snapshot.map((item) => ({
    snapshotItemId: item._id,
    result: 'NOT_TESTED',
  }))
}
