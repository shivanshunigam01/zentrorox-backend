import type { Request } from 'express'
import {
  AdditionalWorkRequest,
  Estimate,
  JobCard,
  JobWorkItem,
  ServiceVisit,
} from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
export async function listByJobCard(req: Request, jobCardId: string) {
  return AdditionalWorkRequest.find({ tenantId: req.tenantId!, jobCardId }).sort({ createdAt: -1 }).lean()
}

export async function createAdditionalWork(req: Request, body: Record<string, unknown>) {
  const jobCardId = String(body.jobCardId)
  const jc = await JobCard.findOne({ _id: jobCardId, tenantId: req.tenantId! })
  if (!jc) throw new NotFoundError('Job card not found')
  const visit = await ServiceVisit.findById(jc.serviceVisitId)
  if (!visit) throw new NotFoundError('Visit not found')

  const requestNumber = await generateDocumentNumber(req.tenantId!, 'ADDITIONAL_WORK')
  const doc = await AdditionalWorkRequest.create({
    tenantId: req.tenantId!,
    branchId: jc.branchId,
    requestNumber,
    customerId: jc.customerId,
    vehicleId: jc.vehicleId,
    serviceVisitId: jc.serviceVisitId,
    jobCardId: jc._id,
    jobCardRevisionNumber: jc.revisionNumber ?? 1,
    sourceWorkItemId: body.sourceWorkItemId,
    discoveredBy: req.user?.id,
    discoveryCategory: body.discoveryCategory,
    faultDescription: String(body.faultDescription ?? ''),
    component: body.component,
    technicalFinding: body.technicalFinding,
    whyNotVisibleEarlier: body.whyNotVisibleEarlier,
    safetySeverity: body.safetySeverity,
    additionalWorkDescription: body.additionalWorkDescription,
    estimatedLabourHours: body.estimatedLabourHours,
    technicianRemarks: body.technicianRemarks,
    requestPriority: body.requestPriority,
    status: 'DRAFT',
    blocksWorkItemIds: body.sourceWorkItemId ? [body.sourceWorkItemId] : [],
  })

  if (body.sourceWorkItemId) {
    await JobWorkItem.updateOne(
      { _id: body.sourceWorkItemId, jobCardId: jc._id },
      { $set: { executionStatus: 'WAITING_FOR_APPROVAL' } },
    )
  }

  await createAuditLog({ req, module: 'additional_work', action: 'CREATED', recordId: doc._id.toString() })
  return doc
}

export async function submitAdditionalWork(req: Request, id: string) {
  const doc = await AdditionalWorkRequest.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Request not found')
  if (doc.status !== 'DRAFT') throw new ValidationError('Only draft requests can be submitted')
  if (!doc.faultDescription?.trim()) throw new ValidationError('Fault description required')
  doc.status = 'SUBMITTED'
  await doc.save()
  return doc
}

export async function sendToEstimate(req: Request, id: string) {
  const doc = await AdditionalWorkRequest.findOne({ _id: id, tenantId: req.tenantId! })
  if (!doc) throw new NotFoundError('Request not found')
  if (!['SUBMITTED', 'SUPERVISOR_REVIEW', 'APPROVED_FOR_ESTIMATION'].includes(doc.status)) {
    throw new ValidationError('Request not ready for estimation')
  }

  const primary = await Estimate.findOne({
    tenantId: req.tenantId!,
    serviceVisitId: doc.serviceVisitId,
    estimateKind: 'PRIMARY',
  })
  if (!primary) throw new ValidationError('Primary estimate missing')

  const estimateNumber = await generateDocumentNumber(req.tenantId!, 'ESTIMATE')
  const supplementary = await Estimate.create({
    tenantId: req.tenantId!,
    branchId: doc.branchId,
    serviceVisitId: doc.serviceVisitId,
    estimateKind: 'SUPPLEMENTARY',
    parentEstimateId: primary._id,
    jobCardId: doc.jobCardId,
    additionalWorkRequestId: doc._id,
    estimateNumber,
    status: 'DRAFT',
    currentRevisionNumber: 1,
    revisions: [{
      revisionNumber: 1,
      items: [],
      totals: { subtotal: 0, discountTotal: 0, taxableAmount: 0, taxTotal: 0, grandTotal: 0 },
      terms: `Supplementary estimate for ${doc.requestNumber}: ${doc.faultDescription}`,
      frozen: false,
    }],
    createdBy: req.user?.id,
  })

  doc.status = 'ESTIMATE_PREPARED'
  doc.supplementaryEstimateId = supplementary._id
  await doc.save()

  return { additionalWork: doc, estimate: supplementary }
}
