import PDFDocument from 'pdfkit'
import { loadImagesForPdf, type PdfImageSlot } from '../../utils/pdf-image-loader.js'

type PdfDoc = InstanceType<typeof PDFDocument>

export type RepairReportImageSection = {
  title: string
  images: PdfImageSlot[]
}

export type RepairReportContext = {
  tenantName: string
  customerName: string
  registrationNo: string
  vehicleMakeModel: string
  bookingReference?: string
  jobCardNumber: string
  jobCardRevision?: number
  qcReference?: string
  qcStatus?: string
  roadTestStatus?: string
  vocComplaints: string[]
  diagnosisFindings: string[]
  completedWork: string[]
  partsReplaced: string[]
  inspectorRemarks?: string
  advisories: string[]
  imageSections: RepairReportImageSection[]
}

const PAGE_BOTTOM = 720

function ensureSpace(doc: PdfDoc, height: number) {
  if (doc.y + height > PAGE_BOTTOM) doc.addPage()
}

async function renderImageSection(doc: PdfDoc, section: RepairReportImageSection) {
  ensureSpace(doc, 40)
  doc.moveDown(0.5).fontSize(11).text(section.title, { underline: true })
  if (!section.images.length) {
    doc.fontSize(9).text('(No images on file for this section)')
    return
  }
  const loaded = await loadImagesForPdf(section.images)
  for (const img of loaded) {
    ensureSpace(doc, 120)
    if (img.caption) doc.fontSize(9).text(img.caption)
    if (img.buffer) {
      try {
        doc.image(img.buffer, { fit: [500, 200], align: 'center' })
        doc.moveDown(0.25)
      } catch {
        doc.fontSize(8).text('(Could not embed image)')
      }
    } else {
      doc.fontSize(8).text(`(${img.error ?? 'Image not available'})`)
    }
  }
}

export async function generateRepairReportPdfBuffer(ctx: RepairReportContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('error', reject)

    const finish = async () => {
      try {
        for (const section of ctx.imageSections) {
          await renderImageSection(doc, section)
        }
        doc.end()
      } catch (e) {
        reject(e)
      }
    }

    doc.on('end', () => resolve(Buffer.concat(chunks)))

    doc.fontSize(14).text('Vehicle Service Completion Report', { align: 'center', underline: true })
    doc.moveDown(0.5)
    doc.fontSize(10).text(ctx.tenantName, { align: 'center' })
    doc.moveDown()
    doc.text(`Customer: ${ctx.customerName}`)
    doc.text(`Vehicle: ${ctx.registrationNo} — ${ctx.vehicleMakeModel}`)
    if (ctx.bookingReference) doc.text(`Booking: ${ctx.bookingReference}`)
    doc.text(`Job Card: ${ctx.jobCardNumber}${ctx.jobCardRevision ? ` (Rev ${ctx.jobCardRevision})` : ''}`)
    doc.text(`QC: ${ctx.qcReference ?? '—'} | Status: ${ctx.qcStatus ?? '—'} | Road test: ${ctx.roadTestStatus ?? '—'}`)

    doc.moveDown().fontSize(11).text('Original VOC', { underline: true })
    if (ctx.vocComplaints.length) ctx.vocComplaints.forEach((c) => doc.fontSize(10).text(`• ${c}`))
    else doc.fontSize(10).text('No VOC complaints recorded.')

    doc.moveDown().fontSize(11).text('Diagnosis / inspection findings', { underline: true })
    if (ctx.diagnosisFindings.length) ctx.diagnosisFindings.forEach((c) => doc.fontSize(10).text(`• ${c}`))
    else doc.text('—')

    doc.moveDown().fontSize(11).text('Completed repair work', { underline: true })
    ctx.completedWork.forEach((c) => doc.fontSize(10).text(`• ${c}`))

    doc.moveDown().fontSize(11).text('Parts replaced / consumed (billable scope)', { underline: true })
    ctx.partsReplaced.forEach((c) => doc.fontSize(10).text(`• ${c}`))

    if (ctx.inspectorRemarks) {
      doc.moveDown().fontSize(11).text('Inspector remarks', { underline: true })
      doc.fontSize(10).text(ctx.inspectorRemarks)
    }

    if (ctx.advisories.length) {
      doc.moveDown().fontSize(11).text('Customer advisories', { underline: true })
      ctx.advisories.forEach((a) => doc.fontSize(10).text(`• ${a}`))
    }

    void finish()
  })
}
