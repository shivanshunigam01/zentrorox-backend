import type { Types } from 'mongoose'

export type EInvoiceLinePayload = {
  description: string
  hsnSac?: string
  quantity: number
  unitPrice: number
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
}

export type EInvoicePayload = {
  version: '1.1'
  tenantGstin: string
  customerGstin?: string
  invoiceNumber: string
  invoiceDate: string
  placeOfSupply?: string
  documentType: 'INV'
  lines: EInvoiceLinePayload[]
  taxableValue: number
  cgstTotal: number
  sgstTotal: number
  igstTotal: number
  grandTotal: number
  irnReference?: string
}

export function mapFinalInvoiceToEInvoicePayload(inv: {
  invoiceNumber: string
  issuedAt?: Date | null
  placeOfSupply?: string | null
  customerSnapshot?: { gstin?: string } | null
  supplierSnapshot?: { gstin?: string } | null
  taxSummary?: {
    taxableValue?: number
    cgstTotal?: number
    sgstTotal?: number
    igstTotal?: number
    grandTotal?: number
  } | null
  lines?: Array<{
    description?: string
    hsnSac?: string
    quantity?: number
    unitPrice?: number
    taxableValue?: number
    cgst?: number
    sgst?: number
    igst?: number
  }>
  _id: Types.ObjectId | string
}): EInvoicePayload {
  const issued = inv.issuedAt ?? new Date()
  const dateStr = issued.toISOString().slice(0, 10)
  const supplierGstin = inv.supplierSnapshot?.gstin ?? ''
  return {
    version: '1.1',
    tenantGstin: supplierGstin,
    customerGstin: inv.customerSnapshot?.gstin,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: dateStr,
    placeOfSupply: inv.placeOfSupply ?? undefined,
    documentType: 'INV',
    lines: (inv.lines ?? []).map((l) => ({
      description: l.description ?? 'Line',
      hsnSac: l.hsnSac,
      quantity: l.quantity ?? 1,
      unitPrice: l.unitPrice ?? 0,
      taxableValue: l.taxableValue ?? 0,
      cgst: l.cgst ?? 0,
      sgst: l.sgst ?? 0,
      igst: l.igst ?? 0,
    })),
    taxableValue: inv.taxSummary?.taxableValue ?? 0,
    cgstTotal: inv.taxSummary?.cgstTotal ?? 0,
    sgstTotal: inv.taxSummary?.sgstTotal ?? 0,
    igstTotal: inv.taxSummary?.igstTotal ?? 0,
    grandTotal: inv.taxSummary?.grandTotal ?? 0,
    irnReference: String(inv._id),
  }
}
