import PDFDocument from 'pdfkit'

export type JobCardPdfContext = {
  tenantName: string
  branchName: string
  jobCardNumber: string
  visitNumber: string
  customerName: string
  customerMobile?: string
  registrationNo: string
  vehicleMakeModel: string
  estimateNumber?: string
  estimateRevision?: number
  approvalReference?: string
  financialAuthStatus?: string
  vocSummary?: string
  workItems: Array<{ description: string; category?: string; hours?: number }>
  teams: Array<{ name: string; members?: string }>
  locations: string[]
  promisedDelivery?: string
  internalTarget?: string
  instructions?: string
}

export async function generateJobCardPdfBuffer(ctx: JobCardPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(14).text(ctx.tenantName, { align: 'center' })
    doc.fontSize(10).text(ctx.branchName, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text('JOB CARD', { align: 'center', underline: true })
    doc.fontSize(10)
    doc.text(`Job Card: ${ctx.jobCardNumber}    Visit: ${ctx.visitNumber}`)
    doc.text(`Customer: ${ctx.customerName}${ctx.customerMobile ? ` (${ctx.customerMobile})` : ''}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    if (ctx.estimateNumber) {
      doc.text(`Estimate: ${ctx.estimateNumber} Rev ${ctx.estimateRevision ?? '—'}  Approval: ${ctx.approvalReference ?? '—'}`)
    }
    doc.text(`Financial authorization: ${ctx.financialAuthStatus ?? '—'}`)
    if (ctx.vocSummary) doc.text(`VOC: ${ctx.vocSummary}`)

    doc.moveDown().text('Approved work items:', { underline: true })
    for (const w of ctx.workItems) {
      doc.text(`• ${w.description} (${w.category ?? '—'})${w.hours ? ` — ${w.hours}h` : ''}`)
    }

    doc.moveDown().text('Team assignments:', { underline: true })
    for (const t of ctx.teams) {
      doc.text(`• ${t.name}${t.members ? `: ${t.members}` : ''}`)
    }
    if (ctx.locations.length) doc.text(`Locations: ${ctx.locations.join(', ')}`)

    doc.moveDown()
    if (ctx.internalTarget) doc.text(`Internal target: ${ctx.internalTarget}`)
    if (ctx.promisedDelivery) doc.text(`Customer promised delivery: ${ctx.promisedDelivery}`)
    if (ctx.instructions) doc.text(`Instructions: ${ctx.instructions}`)

    doc.moveDown(2)
    doc.fontSize(9).text('Workshop executive / Supervisor acknowledgment — sign on printed copy.', { align: 'left' })
    doc.end()
  })
}
