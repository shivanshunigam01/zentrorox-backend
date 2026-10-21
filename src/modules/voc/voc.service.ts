import { VocRecord } from '../../models/index.js'
import { ConflictError, NotFoundError } from '../../utils/errors.js'
import type { Request } from 'express'
import type { VocSource } from '../../types/enums.js'

type BookingLean = {
  _id: { toString(): string }
  customerComplaint?: string
  breakdownDetails?: { symptoms?: string }
  bookingType?: string
}

export async function ensureVocFromBooking(
  req: Request,
  visitId: string,
  booking: BookingLean | null,
) {
  if (!booking) return
  let record = await VocRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!record) {
    record = await VocRecord.create({
      tenantId: req.tenantId!,
      branchId: req.branchId,
      visitId,
      bookingId: booking._id,
      complaints: [],
    })
  }
  if (record.confirmationStatus === 'CONFIRMED') return

  const existingFromBooking = record.complaints.some((c) => c.source === 'BOOKING' || c.source === 'BREAKDOWN')
  if (existingFromBooking) return

  const lines: Array<{ description: string; source: VocSource; title?: string }> = []
  if (booking.customerComplaint) {
    lines.push({ title: 'Booking complaint', description: booking.customerComplaint, source: 'BOOKING' })
  }
  if (booking.breakdownDetails?.symptoms) {
    lines.push({
      title: 'Breakdown symptoms',
      description: booking.breakdownDetails.symptoms,
      source: 'BREAKDOWN',
    })
  }
  if (!lines.length) return

  for (const line of lines) {
    record.complaints.push({
      title: line.title,
      description: line.description,
      source: line.source,
      status: 'DRAFT',
      enteredBy: req.user?.id as unknown as typeof record.complaints[0]['enteredBy'],
    })
  }
  await record.save()
}

export async function getVoc(req: Request, visitId: string) {
  let record = await VocRecord.findOne({ tenantId: req.tenantId!, visitId }).lean()
  if (!record) {
    const created = await VocRecord.create({
      tenantId: req.tenantId!,
      branchId: req.branchId,
      visitId,
      complaints: [],
    })
    record = created.toObject()
  }
  return { ...record, id: record._id.toString() }
}

export async function upsertVoc(req: Request, visitId: string, body: {
  complaints?: Array<Record<string, unknown>>
  bookingId?: string
}) {
  const record = await VocRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!record) throw new NotFoundError('VOC record not found')
  if (record.confirmationStatus === 'CONFIRMED') {
    throw new ConflictError('Confirmed VOC cannot be replaced; add amendments in a future phase')
  }

  if (body.bookingId) record.bookingId = body.bookingId as unknown as typeof record.bookingId
  if (body.complaints) {
    record.complaints = body.complaints.map((c) => ({
      ...c,
      enteredBy: req.user?.id,
      source: (c.source as VocSource) ?? 'ADVISOR',
      status: 'DRAFT',
    })) as typeof record.complaints
  }
  await record.save()
  return { id: record._id.toString(), confirmationStatus: record.confirmationStatus, complaints: record.complaints }
}

export async function confirmVoc(req: Request, visitId: string) {
  const record = await VocRecord.findOne({ tenantId: req.tenantId!, visitId })
  if (!record) throw new NotFoundError('VOC record not found')

  record.confirmationStatus = 'CONFIRMED'
  record.confirmedAt = new Date()
  record.confirmedBy = req.user?.id as unknown as typeof record.confirmedBy
  for (const c of record.complaints) {
    c.status = 'CONFIRMED'
  }
  await record.save()

  return { id: record._id.toString(), confirmationStatus: record.confirmationStatus }
}
