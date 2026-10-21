import {
  FinalInvoice,
  JobCard,
  QualityControlCase,
  ServiceVisit,
} from '../../models/index.js'

export async function assertEligibleForInvoice(tenantId: string, serviceVisitId: string) {
  const reasons: string[] = []
  const visit = await ServiceVisit.findOne({ _id: serviceVisitId, tenantId })
  if (!visit) return { eligible: false, reasons: ['Service visit not found'] }
  if (!visit.invoiceReady) reasons.push('Visit is not invoice-ready (QC clearance required)')

  const jc = await JobCard.findOne({ tenantId, serviceVisitId })
  if (!jc) reasons.push('Job card missing')
  else if (!['INVOICE_READY', 'QC_PASSED'].includes(jc.status)) {
    reasons.push(`Job card not cleared for billing (status: ${jc.status})`)
  }

  const qc = await QualityControlCase.findOne({ tenantId, serviceVisitId: visit._id })
  if (!qc || !['QC_PASSED', 'RELEASED_FOR_INVOICE'].includes(qc.status)) {
    reasons.push('Final QC pass required')
  }

  const issued = await FinalInvoice.findOne({ tenantId, serviceVisitId, status: 'ISSUED' })
  if (issued) reasons.push('An issued invoice already exists for this visit')

  return { eligible: reasons.length === 0, reasons, visit, jobCard: jc, qcCase: qc }
}

export function financialYearIndia(date = new Date()): string {
  const y = date.getFullYear()
  const m = date.getMonth()
  const start = m >= 3 ? y : y - 1
  return `${start}-${String(start + 1).slice(-2)}`
}
