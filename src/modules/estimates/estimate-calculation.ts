import type { EstimateLineCategory } from '../../types/enums.js'

export type CalcLineInput = {
  lineId: string
  category: EstimateLineCategory | string
  quantity: number
  unitRate: number
  labourHours?: number
  labourRate?: number
  discountAmount?: number
  taxRule?: {
    id: string
    gstPercent: number
    cgstPercent: number
    sgstPercent: number
    igstPercent: number
    taxInclusive?: boolean
  }
  useIgst: boolean
}

export type CalcLineOutput = CalcLineInput & {
  grossAmount: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  finalAmount: number
  effectiveGstRate: number
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function toPaise(amount: number): number {
  return Math.round(amount * 100)
}

export function fromPaise(paise: number): number {
  return paise / 100
}

export function calculateLine(line: CalcLineInput): CalcLineOutput {
  const qty = line.quantity || 1
  let gross = line.unitRate * qty
  if (line.labourHours != null && line.labourRate != null) {
    gross = line.labourHours * line.labourRate
  }
  gross = roundMoney(gross)
  const discount = roundMoney(line.discountAmount ?? 0)
  let taxable = roundMoney(Math.max(0, gross - discount))

  let cgst = 0
  let sgst = 0
  let igst = 0
  let final = taxable
  const rate = line.taxRule?.gstPercent ?? 0

  if (line.taxRule && rate > 0) {
    if (line.taxRule.taxInclusive) {
      const base = roundMoney(taxable / (1 + rate / 100))
      taxable = base
    }
    if (line.useIgst) {
      igst = roundMoney(taxable * (line.taxRule.igstPercent || rate) / 100)
    } else {
      cgst = roundMoney(taxable * (line.taxRule.cgstPercent || rate / 2) / 100)
      sgst = roundMoney(taxable * (line.taxRule.sgstPercent || rate / 2) / 100)
    }
    final = roundMoney(taxable + cgst + sgst + igst)
  }

  return {
    ...line,
    grossAmount: gross,
    taxableAmount: taxable,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: igst,
    finalAmount: final,
    effectiveGstRate: rate,
  }
}

export function calculateEstimateTotals(lines: CalcLineOutput[]) {
  const sum = (cat?: string) =>
    roundMoney(
      lines
        .filter((l) => !cat || l.category === cat)
        .reduce((a, l) => a + l.finalAmount, 0),
    )

  const grossAmount = roundMoney(lines.reduce((a, l) => a + l.grossAmount, 0))
  const totalDiscount = roundMoney(lines.reduce((a, l) => a + (l.discountAmount ?? 0), 0))
  const taxableAmount = roundMoney(lines.reduce((a, l) => a + l.taxableAmount, 0))
  const cgst = roundMoney(lines.reduce((a, l) => a + l.cgstAmount, 0))
  const sgst = roundMoney(lines.reduce((a, l) => a + l.sgstAmount, 0))
  const igst = roundMoney(lines.reduce((a, l) => a + l.igstAmount, 0))
  const rawFinal = roundMoney(taxableAmount + cgst + sgst + igst)
  const finalAmount = roundMoney(rawFinal)
  const roundingAdjustment = roundMoney(finalAmount - rawFinal)

  return {
    labourSubtotal: sum('LABOUR'),
    partsSubtotal: sum('PARTS'),
    lubricantSubtotal: sum('LUBRICANT'),
    batterySubtotal: sum('BATTERY'),
    tyreSubtotal: sum('TYRE'),
    dentingPaintingSubtotal: sum('DENTING_PAINTING'),
    accessoriesSubtotal: sum('ACCESSORY'),
    logisticsSubtotal: roundMoney(sum('PICKUP') + sum('DROP') + sum('TOWING')),
    grossAmount,
    totalDiscount,
    taxableAmount,
    cgst,
    sgst,
    igst,
    roundingAdjustment,
    finalAmount,
  }
}
