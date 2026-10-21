import type { Request } from 'express'
import type { ClientSession } from 'mongoose'
import mongoose from 'mongoose'
import { CreditNote, FinalInvoice, InvoiceAllocation } from '../../models/index.js'
import { generateDocumentNumber } from '../../utils/numbering.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { createAuditLog } from '../../utils/audit.js'
import { roundMoney } from '../estimates/estimate-calculation.js'
import { financialYearIndia } from './billing-eligibility.js'
import {
  computeInvoiceBalanceDue,
  creditNoteStatusAfterApply,
} from './ar-receivables.service.js'

export async function createCreditNoteDraft(
  req: Request,
  body: { invoiceId: string; reason?: string; amount?: number; idempotencyKey?: string },
) {
  if (body.idempotencyKey) {
    const dup = await CreditNote.findOne({ tenantId: req.tenantId!, idempotencyKey: body.idempotencyKey }).lean()
    if (dup) return dup
  }
  const inv = await FinalInvoice.findOne({
    _id: body.invoiceId,
    tenantId: req.tenantId!,
    status: 'ISSUED',
  })
  if (!inv) throw new ValidationError('Issued invoice required to create credit note')
  const maxCredit = inv.balanceDue ?? 0
  const amount = body.amount != null ? Number(body.amount) : maxCredit
  if (!amount || amount <= 0) throw new ValidationError('Credit amount must be positive')
  if (amount > maxCredit + 0.01) throw new ValidationError('Credit amount exceeds invoice outstanding balance')

  const creditNoteNumber = await generateDocumentNumber(req.tenantId!, 'CREDIT_NOTE')
  const cn = await CreditNote.create({
    tenantId: req.tenantId!,
    branchId: inv.branchId,
    customerId: inv.customerId,
    invoiceId: inv._id,
    serviceVisitId: inv.serviceVisitId,
    creditNoteNumber,
    financialYear: financialYearIndia(),
    status: 'DRAFT',
    reason: body.reason,
    grandTotal: roundMoney(amount),
    amountRemaining: roundMoney(amount),
    lines: [
      {
        description: body.reason ?? `Credit against invoice ${inv.invoiceNumber}`,
        taxableValue: roundMoney(amount),
        lineTotal: roundMoney(amount),
      },
    ],
    idempotencyKey: body.idempotencyKey,
  })
  await createAuditLog({ req, module: 'credit_note', action: 'DRAFT_CREATED', recordId: cn._id.toString() })
  return cn
}

export async function issueCreditNote(req: Request, creditNoteId: string) {
  const cn = await CreditNote.findOne({ _id: creditNoteId, tenantId: req.tenantId! })
  if (!cn) throw new NotFoundError('Credit note not found')
  if (cn.status === 'ISSUED') return cn
  if (cn.status !== 'DRAFT') throw new ValidationError('Only draft credit notes can be issued')
  if (cn.invoiceId) {
    const inv = await FinalInvoice.findById(cn.invoiceId)
    if (!inv || inv.status !== 'ISSUED') throw new ValidationError('Linked invoice must be issued')
    if ((cn.grandTotal ?? 0) > (inv.balanceDue ?? 0) + 0.01) {
      throw new ValidationError('Credit note exceeds invoice balance due')
    }
  }
  cn.status = 'ISSUED'
  cn.issuedAt = new Date()
  cn.issuedBy = req.user?.id as unknown as typeof cn.issuedBy
  cn.amountRemaining = cn.grandTotal
  await cn.save()
  await createAuditLog({ req, module: 'credit_note', action: 'ISSUED', recordId: creditNoteId })
  return cn
}

export async function applyCreditNoteToInvoice(
  req: Request,
  body: { creditNoteId: string; invoiceId: string; amount?: number; idempotencyKey?: string },
) {
  const session = await mongoose.startSession()
  try {
    let result: { creditNote: typeof CreditNote.prototype; invoice: typeof FinalInvoice.prototype }
    await session.withTransaction(async () => {
      result = await applyCreditNoteToInvoiceTx(req, body, session)
    })
    return result!
  } finally {
    await session.endSession()
  }
}

async function applyCreditNoteToInvoiceTx(
  req: Request,
  body: { creditNoteId: string; invoiceId: string; amount?: number; idempotencyKey?: string },
  session: ClientSession,
) {
  if (body.idempotencyKey) {
    const dup = await InvoiceAllocation.findOne({
      tenantId: req.tenantId!,
      idempotencyKey: body.idempotencyKey,
    }).session(session)
    if (dup) {
      const cn = await CreditNote.findById(body.creditNoteId).session(session)
      const inv = await FinalInvoice.findById(body.invoiceId).session(session)
      if (!cn || !inv) throw new NotFoundError('Credit note or invoice missing')
      return { creditNote: cn, invoice: inv }
    }
  }

  const cn = await CreditNote.findOne({
    _id: body.creditNoteId,
    tenantId: req.tenantId!,
    status: { $in: ['ISSUED', 'PARTIALLY_APPLIED'] },
  }).session(session)
  if (!cn) throw new NotFoundError('Issued credit note required')

  const inv = await FinalInvoice.findOne({
    _id: body.invoiceId,
    tenantId: req.tenantId!,
    status: 'ISSUED',
  }).session(session)
  if (!inv) throw new NotFoundError('Issued invoice required')
  if (cn.customerId.toString() !== inv.customerId.toString()) {
    throw new ValidationError('Credit note and invoice must belong to the same customer')
  }
  if (cn.invoiceId && cn.invoiceId.toString() !== inv._id.toString()) {
    throw new ValidationError('Credit note is linked to a different invoice')
  }

  const existing = await InvoiceAllocation.findOne({
    tenantId: req.tenantId!,
    invoiceId: inv._id,
    sourceCreditNoteId: cn._id,
  }).session(session)
  if (existing) throw new ValidationError('Credit note already applied to this invoice')

  const remainingOnNote = cn.amountRemaining ?? 0
  const applyAmount = roundMoney(
    body.amount != null ? Math.min(Number(body.amount), remainingOnNote) : remainingOnNote,
  )
  if (applyAmount <= 0) throw new ValidationError('No remaining credit to apply')
  if (applyAmount > (inv.balanceDue ?? 0) + 0.01) {
    throw new ValidationError('Apply amount exceeds invoice balance due')
  }

  await InvoiceAllocation.create(
    [
      {
        tenantId: req.tenantId!,
        invoiceId: inv._id,
        sourceCreditNoteId: cn._id,
        amount: applyAmount,
        allocationType: 'CREDIT_NOTE',
        allocatedBy: req.user?.id,
        idempotencyKey: body.idempotencyKey,
      },
    ],
    { session },
  )

  cn.amountApplied = roundMoney((cn.amountApplied ?? 0) + applyAmount)
  cn.amountRemaining = roundMoney(Math.max(0, (cn.grandTotal ?? 0) - cn.amountApplied))
  cn.status = creditNoteStatusAfterApply(cn.grandTotal ?? 0, cn.amountApplied)
  await cn.save({ session })

  inv.creditsApplied = roundMoney((inv.creditsApplied ?? 0) + applyAmount)
  inv.balanceDue = computeInvoiceBalanceDue({
    grandTotal: inv.grandTotal ?? 0,
    advanceAllocated: inv.advanceAllocated,
    paymentsReceived: inv.paymentsReceived,
    creditsApplied: inv.creditsApplied,
  })
  if (inv.balanceDue <= 0) inv.paymentStatus = 'PAID'
  else if ((inv.paymentsReceived ?? 0) > 0 || (inv.creditsApplied ?? 0) > 0) inv.paymentStatus = 'PARTIALLY_PAID'
  await inv.save({ session })

  await createAuditLog({
    req,
    module: 'credit_note',
    action: 'APPLIED',
    recordId: cn._id.toString(),
    newValue: { invoiceId: inv._id.toString(), amount: applyAmount },
  })

  return { creditNote: cn, invoice: inv }
}

export async function cancelCreditNote(req: Request, creditNoteId: string, reason: string) {
  const cn = await CreditNote.findOne({ _id: creditNoteId, tenantId: req.tenantId! })
  if (!cn) throw new NotFoundError('Credit note not found')
  if (cn.status === 'CANCELLED' || cn.status === 'REVERSED') return cn
  if ((cn.amountApplied ?? 0) > 0) {
    throw new ValidationError('Cannot cancel a credit note with applied amounts — reverse allocations first')
  }
  cn.status = 'CANCELLED'
  cn.cancelledAt = new Date()
  cn.cancelReason = reason
  cn.amountRemaining = 0
  await cn.save()
  await createAuditLog({ req, module: 'credit_note', action: 'CANCELLED', recordId: creditNoteId, newValue: { reason } })
  return cn
}
