import PDFDocument from 'pdfkit'

export type QcPdfContext = {
  tenantName: string
  branchName: string
  qcReference: string
  attemptNumber: number
  jobCardNumber: string
  customerName: string
  customerMobile?: string
  registrationNo: string
  vehicleMakeModel: string
  gateInOdometer?: number
  finalRoadTestOdometer?: number
  decision: string
  inspectorName: string
  reportDate: string
  workChecks: Array<{ description: string; result: string }>
  quantitySummary: string
  vocSummary: string
  roadTestSummary: string
  remarks?: string
}

export async function generateQcPdfBuffer(ctx: QcPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(14).text(ctx.tenantName, { align: 'center' })
    doc.fontSize(10).text(ctx.branchName, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text('FINAL QUALITY CONTROL REPORT', { align: 'center', underline: true })
    doc.fontSize(10)
    doc.text(`QC Ref: ${ctx.qcReference}  Attempt: ${ctx.attemptNumber}  Date: ${ctx.reportDate}`)
    doc.text(`Job Card: ${ctx.jobCardNumber}`)
    doc.text(`Customer: ${ctx.customerName}${ctx.customerMobile ? ` (${ctx.customerMobile})` : ''}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    if (ctx.gateInOdometer != null) doc.text(`Gate-in odometer: ${ctx.gateInOdometer}`)
    if (ctx.finalRoadTestOdometer != null) doc.text(`Road test odometer: ${ctx.finalRoadTestOdometer}`)

    doc.moveDown().text('Work verification:', { underline: true })
    for (const w of ctx.workChecks.slice(0, 40)) {
      doc.text(`• ${w.description} — ${w.result}`)
    }

    doc.moveDown().text(`Quantity: ${ctx.quantitySummary}`)
    doc.text(`VOC: ${ctx.vocSummary}`)
    doc.text(`Road test: ${ctx.roadTestSummary}`)
    doc.moveDown().text(`Decision: ${ctx.decision}`, { underline: true })
    doc.text(`Inspector: ${ctx.inspectorName}`)
    if (ctx.remarks) doc.text(`Remarks: ${ctx.remarks}`)

    doc.end()
  })
}
