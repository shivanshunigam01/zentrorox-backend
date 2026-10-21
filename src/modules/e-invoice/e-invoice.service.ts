import type { Request } from 'express'
import { FinalInvoice, Tenant } from '../../models/index.js'
import { ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { assessEInvoiceEligibility } from './e-invoice-eligibility.js'
import { mapFinalInvoiceToEInvoicePayload } from './e-invoice-payload.js'
import { resolveEInvoiceProvider } from './e-invoice-provider.js'

export async function assertEInvoiceReadyForIssue(
  tenantId: string,
  inv: {
    grandTotal: number
    issuedAt?: Date | null
    placeOfSupply?: string | null
    customerSnapshot?: { gstin?: string } | null
    supplierSnapshot?: { gstin?: string } | null
    eInvoice?: { irn?: string | null; irnStatus?: string } | null
  },
) {
  const tenant = await Tenant.findById(tenantId).lean()
  const settings = (tenant?.eInvoicingSettings ?? {}) as {
    enabled?: boolean
    mandatoryFrom?: Date
    turnoverThresholdInr?: number
    declaredAnnualTurnoverInr?: number
    b2bGstinRequired?: boolean
  }
  const assessment = assessEInvoiceEligibility({
    tenantGstin: tenant?.gstin,
    eInvoicingEnabled: settings.enabled === true,
    mandatoryFrom: settings.mandatoryFrom,
    turnoverThresholdInr: settings.turnoverThresholdInr,
    declaredAnnualTurnoverInr: settings.declaredAnnualTurnoverInr,
    invoiceDate: inv.issuedAt ?? new Date(),
    customerGstin: inv.customerSnapshot?.gstin,
    grandTotal: inv.grandTotal ?? 0,
    b2bGstinRequired: settings.b2bGstinRequired !== false,
  })

  if (inv.eInvoice?.irn?.trim()) {
    throw new ValidationError('Duplicate IRN prevention: invoice already has an IRN')
  }

  if (assessment.requirement !== 'REQUIRED') {
    return { required: false, assessment }
  }

  const provider = resolveEInvoiceProvider()
  if (!provider) {
    throw new ValidationError(
      'E-invoice is required for this invoice but GSP credentials are not configured (EINVOICE_GSP_BASE_URL, EINVOICE_GSP_CLIENT_ID, EINVOICE_GSP_CLIENT_SECRET). Live IRN generation is BLOCKED.',
    )
  }

  return { required: true, assessment, provider }
}

export async function requestIrnForIssuedInvoice(req: Request, invoiceId: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv) throw new ValidationError('Issued invoice required')

  const prep = await assertEInvoiceReadyForIssue(req.tenantId!, inv)
  if (!prep.required) {
    inv.set('eInvoice', {
      ...(inv.eInvoice ?? {}),
      eligibility: prep.assessment.requirement,
      irnStatus: 'NOT_REQUIRED',
    })
    await inv.save()
    return { invoice: inv, irnGenerated: false }
  }

  const payload = mapFinalInvoiceToEInvoicePayload(inv.toObject() as Parameters<typeof mapFinalInvoiceToEInvoicePayload>[0])
  inv.set('eInvoice', { ...(inv.eInvoice ?? {}), eligibility: 'REQUIRED', irnStatus: 'PENDING' })
  await inv.save()

  const result = await prep.provider!.generateIrn(payload)
  if (!result.success || !result.irn) {
    inv.set('eInvoice', {
      ...(inv.eInvoice ?? {}),
      irnStatus: 'FAILED',
      lastError: result.errorMessage ?? 'IRN generation failed',
    })
    await inv.save()
    await createAuditLog({
      req,
      module: 'e_invoice',
      action: 'IRN_FAILED',
      recordId: invoiceId,
      newValue: { error: result.errorMessage },
    })
    throw new ValidationError(result.errorMessage ?? 'IRN generation failed')
  }

  inv.set('eInvoice', {
    eligibility: 'REQUIRED',
    irnStatus: 'GENERATED',
    irn: result.irn,
    ackNo: result.ackNo,
    ackDate: result.ackDate,
    signedQrCode: result.signedQrCode,
    providerReference: result.providerReference,
    lastError: undefined,
  })
  await inv.save()
  await createAuditLog({
    req,
    module: 'e_invoice',
    action: 'IRN_GENERATED',
    recordId: invoiceId,
    newValue: { irn: result.irn, ackNo: result.ackNo },
  })
  return { invoice: inv, irnGenerated: true }
}

export async function cancelInvoiceIrn(req: Request, invoiceId: string, reason: string) {
  const inv = await FinalInvoice.findOne({ _id: invoiceId, tenantId: req.tenantId!, status: 'ISSUED' })
  if (!inv?.eInvoice?.irn) throw new ValidationError('No IRN to cancel')
  const provider = resolveEInvoiceProvider()
  if (!provider) throw new ValidationError('GSP not configured for IRN cancellation')

  const result = await provider.cancelIrn(inv.eInvoice.irn, reason)
  if (!result.success) throw new ValidationError(result.errorMessage ?? 'IRN cancel failed')

  inv.set('eInvoice', {
    ...inv.eInvoice,
    irnStatus: 'CANCELLED',
    cancelledAt: new Date(),
    cancelReason: reason,
  })
  await inv.save()
  await createAuditLog({ req, module: 'e_invoice', action: 'IRN_CANCELLED', recordId: invoiceId, newValue: { reason } })
  return inv
}
