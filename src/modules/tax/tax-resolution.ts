import { TaxRule } from '../../models/index.js'
import { ValidationError } from '../../utils/errors.js'

export type ResolvedTaxRule = {
  id: string
  hsnSac?: string
  gstPercent: number
  cgstPercent: number
  sgstPercent: number
  igstPercent: number
  taxInclusive: boolean
  classification?: string
}

export async function resolveTaxRule(
  tenantId: string,
  hsnSac?: string | null,
  at = new Date(),
): Promise<ResolvedTaxRule | null> {
  const baseQuery = {
    tenantId,
    active: true,
    approvalStatus: 'APPROVED',
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: at } }],
  }
  const rules = await TaxRule.find({
    ...baseQuery,
    ...(hsnSac ? { hsnSac } : {}),
  })
    .sort({ effectiveFrom: -1 })
    .limit(1)
    .lean()
  type TaxDoc = (typeof rules)[number]
  let doc: TaxDoc | null = rules[0] ?? null
  if (!doc && hsnSac) {
    doc = (await TaxRule.findOne(baseQuery).sort({ effectiveFrom: -1 }).lean()) as TaxDoc | null
  }
  if (!doc) return null
  return {
    id: doc._id.toString(),
    hsnSac: doc.hsnSac ?? undefined,
    gstPercent: doc.gstPercent,
    cgstPercent: doc.cgstPercent ?? doc.gstPercent / 2,
    sgstPercent: doc.sgstPercent ?? doc.gstPercent / 2,
    igstPercent: doc.igstPercent ?? doc.gstPercent,
    taxInclusive: !!doc.taxInclusive,
    classification: (doc as { classification?: string }).classification,
  }
}

export async function requireTaxRuleForInvoiceLine(
  tenantId: string,
  category: string,
  hsnSac?: string | null,
): Promise<ResolvedTaxRule> {
  if (category === 'OTHER' && !hsnSac) {
    throw new ValidationError('HSN/SAC required for invoice line')
  }
  const rule = await resolveTaxRule(tenantId, hsnSac)
  if (!rule) {
    throw new ValidationError(`No approved tax rule for HSN/SAC ${hsnSac ?? '(missing)'} on ${category}`)
  }
  if (!hsnSac || hsnSac.trim().length < 4) {
    throw new ValidationError(`Invalid or missing HSN/SAC for category ${category}`)
  }
  return rule
}
