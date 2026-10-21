import PDFDocument from 'pdfkit'

export type InvoicePdfContext = {
  tenantName: string
  branchName: string
  gstin?: string
  invoiceNumber: string
  invoiceDate: string
  customerName: string
  customerAddress?: string
  customerMobile?: string
  customerGstin?: string
  registrationNo: string
  vehicleMakeModel: string
  jobCardNumber: string
  qcReference?: string
  lines: Array<{
    description: string
    hsnSac?: string
    qty: number
    rate: number
    taxable: number
    tax: number
    total: number
  }>
  taxSummary: {
    taxableValue: number
    cgst: number
    sgst: number
    igst: number
    grandTotal: number
  }
  advanceAllocated: number
  paymentsReceived: number
  balanceDue: number
}

export async function generateInvoicePdfBuffer(ctx: InvoicePdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(14).text(ctx.tenantName, { align: 'center' })
    doc.fontSize(10).text(ctx.branchName, { align: 'center' })
    if (ctx.gstin) doc.text(`GSTIN: ${ctx.gstin}`, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text('TAX INVOICE', { align: 'center', underline: true })
    doc.fontSize(10)
    doc.text(`Invoice No: ${ctx.invoiceNumber}    Date: ${ctx.invoiceDate}`)
    doc.text(`Customer: ${ctx.customerName}${ctx.customerMobile ? ` (${ctx.customerMobile})` : ''}`)
    if (ctx.customerAddress) doc.text(ctx.customerAddress)
    if (ctx.customerGstin) doc.text(`Customer GSTIN: ${ctx.customerGstin}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    doc.text(`Job Card: ${ctx.jobCardNumber}  QC: ${ctx.qcReference ?? '—'}`)

    doc.moveDown().text('Items:', { underline: true })
    let sn = 1
    for (const l of ctx.lines) {
      doc.text(
        `${sn++}. ${l.description} | HSN/SAC ${l.hsnSac ?? '—'} | Qty ${l.qty} @ ${l.rate} | Tax ${l.tax} | ${l.total}`,
      )
    }

    doc.moveDown()
    doc.text(`Taxable: ${ctx.taxSummary.taxableValue}`)
    doc.text(`CGST: ${ctx.taxSummary.cgst}  SGST: ${ctx.taxSummary.sgst}  IGST: ${ctx.taxSummary.igst}`)
    doc.text(`Grand Total: ${ctx.taxSummary.grandTotal}`)
    doc.text(`Advances applied: ${ctx.advanceAllocated}`)
    doc.text(`Payments: ${ctx.paymentsReceived}`)
    doc.text(`Balance Due: ${ctx.balanceDue}`, { underline: true })

    doc.end()
  })
}
