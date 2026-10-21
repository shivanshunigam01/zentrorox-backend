import PDFDocument from 'pdfkit'
type EstimateTotals = {
  taxableAmount?: number
  cgst?: number
  sgst?: number
  igst?: number
  finalAmount?: number
}

type PdfContext = {
  tenantName: string
  branchName: string
  branchAddress: string
  gstin?: string
  phone?: string
  email?: string
  estimateNumber: string
  revisionNumber: number
  issueDate: string
  validUntil?: string
  customerName: string
  customerMobile?: string
  registrationNo: string
  vehicleMakeModel: string
  items: Array<{
    description: string
    category: string
    hsnSac?: string
    quantity: number
    unitRate: number
    discountAmount?: number
    finalAmount: number
  }>
  totals: EstimateTotals
}

export function generateEstimatePdfBuffer(ctx: PdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c as Buffer))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).text(ctx.tenantName, { align: 'center' })
    doc.fontSize(10).text(ctx.branchName, { align: 'center' })
    if (ctx.branchAddress) doc.text(ctx.branchAddress, { align: 'center' })
    if (ctx.gstin) doc.text(`GSTIN: ${ctx.gstin}`, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text('ESTIMATE / QUOTATION', { align: 'center', underline: true })
    doc.fontSize(9)
    doc.text(`Estimate No: ${ctx.estimateNumber}  Rev: ${ctx.revisionNumber}`)
    doc.text(`Date: ${ctx.issueDate}${ctx.validUntil ? `  Valid until: ${ctx.validUntil}` : ''}`)
    doc.moveDown()
    doc.text(`Customer: ${ctx.customerName}${ctx.customerMobile ? ` (${ctx.customerMobile})` : ''}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    doc.moveDown()

    doc.fontSize(8)
    const tableTop = doc.y
    doc.text('S#', 48, tableTop)
    doc.text('Description', 70, tableTop)
    doc.text('HSN/SAC', 280, tableTop)
    doc.text('Qty', 340, tableTop)
    doc.text('Rate', 370, tableTop)
    doc.text('Amount', 480, tableTop, { width: 80, align: 'right' })
    doc.moveDown(0.5)
    doc.moveTo(48, doc.y).lineTo(550, doc.y).stroke()

    ctx.items.forEach((item, idx) => {
      if (doc.y > 700) {
        doc.addPage()
        doc.fontSize(8)
      }
      const y = doc.y
      doc.text(String(idx + 1), 48, y)
      doc.text(`${item.category}: ${item.description}`, 70, y, { width: 200 })
      doc.text(item.hsnSac ?? '—', 280, y)
      doc.text(String(item.quantity), 340, y)
      doc.text(item.unitRate.toFixed(2), 370, y)
      doc.text(item.finalAmount.toFixed(2), 480, y, { width: 80, align: 'right' })
      doc.moveDown()
    })

    doc.moveDown()
    doc.text(`Taxable: ₹${ctx.totals.taxableAmount?.toFixed(2) ?? '0.00'}`)
    doc.text(`CGST: ₹${ctx.totals.cgst?.toFixed(2) ?? '0.00'}  SGST: ₹${ctx.totals.sgst?.toFixed(2) ?? '0.00'}  IGST: ₹${ctx.totals.igst?.toFixed(2) ?? '0.00'}`)
    doc.fontSize(11).text(`Grand Total: ₹${ctx.totals.finalAmount?.toFixed(2) ?? '0.00'}`, { align: 'right' })
    doc.moveDown()
    doc.fontSize(7).text('This document is an estimate only and not a tax invoice. Prices subject to customer approval.', { align: 'center' })

    doc.end()
  })
}
