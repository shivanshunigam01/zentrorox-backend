import PDFDocument from 'pdfkit'

export type ReceiptPdfContext = {
  tenantName: string
  legalName?: string
  branchName: string
  branchAddress?: string
  gstin?: string
  phone?: string
  receiptNumber: string
  receiptDate: string
  customerName: string
  customerMobile?: string
  customerAddress?: string
  registrationNo: string
  vehicleMakeModel: string
  bookingReference?: string
  visitReference?: string
  estimateReference?: string
  estimateRevision?: number
  amountReceived: number
  amountInWords: string
  paymentMode: string
  transactionReference?: string
  receivedBy?: string
  paymentStatus: string
  remarks?: string
}

function inrWords(amount: number): string {
  return `Rupees ${amount.toLocaleString('en-IN')} only`
}

export async function generateReceiptPdfBuffer(ctx: ReceiptPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(14).text(ctx.legalName ?? ctx.tenantName, { align: 'center' })
    doc.fontSize(10).text(ctx.branchName, { align: 'center' })
    if (ctx.branchAddress) doc.text(ctx.branchAddress, { align: 'center' })
    if (ctx.gstin) doc.text(`GSTIN: ${ctx.gstin}`, { align: 'center' })
    if (ctx.phone) doc.text(`Tel: ${ctx.phone}`, { align: 'center' })

    doc.moveDown()
    doc.fontSize(12).text('ADVANCE PAYMENT RECEIPT', { align: 'center', underline: true })
    doc.moveDown(0.5)
    doc.fontSize(10)
    doc.text(`Receipt No: ${ctx.receiptNumber}    Date: ${ctx.receiptDate}`)
    doc.text(`Customer: ${ctx.customerName}${ctx.customerMobile ? ` (${ctx.customerMobile})` : ''}`)
    if (ctx.customerAddress) doc.text(`Address: ${ctx.customerAddress}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    if (ctx.bookingReference) doc.text(`Booking: ${ctx.bookingReference}`)
    if (ctx.visitReference) doc.text(`Service Visit: ${ctx.visitReference}`)
    if (ctx.estimateReference) {
      doc.text(`Estimate: ${ctx.estimateReference}${ctx.estimateRevision != null ? ` Rev ${ctx.estimateRevision}` : ''}`)
    }

    doc.moveDown()
    doc.fontSize(11).text(`Amount Received: ₹${ctx.amountReceived.toLocaleString('en-IN')}`, { underline: true })
    doc.text(`In words: ${ctx.amountInWords || inrWords(ctx.amountReceived)}`)
    doc.text(`Payment Mode: ${ctx.paymentMode}`)
    if (ctx.transactionReference) doc.text(`Transaction Ref: ${ctx.transactionReference}`)
    doc.text(`Status: ${ctx.paymentStatus}`)
    if (ctx.receivedBy) doc.text(`Received By: ${ctx.receivedBy}`)
    if (ctx.remarks) doc.text(`Remarks: ${ctx.remarks}`)

    doc.moveDown(2)
    doc.fontSize(9).text(
      'This document is an advance payment receipt and not a GST tax invoice unless separately issued per tax configuration.',
      { align: 'left' },
    )
    doc.end()
  })
}
