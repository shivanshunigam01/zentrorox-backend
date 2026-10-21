import { Booking, PickupTask } from '../../models/index.js'
import { NotFoundError, ValidationError } from '../../utils/errors.js'
import { assertBookingStatusTransition } from '../bookings/booking-transitions.js'
import { normalizeBookingStatus } from '../../types/enums.js'
import type { Request } from 'express'
import type { PickupTaskStatus } from '../../types/enums.js'

function mapPickup(task: {
  _id: { toString(): string }
  status: string
  bookingId: unknown
  visitId?: unknown
  driverId?: unknown
  pickupAddress?: string | null
  scheduledPickupTime?: Date | null
  assignedAt?: Date | null
  actualPickupAt?: Date | null
  handoverAt?: Date | null
  recoveryPartner?: string | null
  recoveryVehicleLabel?: string | null
}) {
  return {
    id: task._id.toString(),
    status: task.status,
    bookingId: task.bookingId?.toString?.() ?? String(task.bookingId),
    visitId: task.visitId ? String(task.visitId) : null,
    driverId: task.driverId ? String(task.driverId) : null,
    pickupAddress: task.pickupAddress,
    scheduledPickupTime: task.scheduledPickupTime,
    assignedAt: task.assignedAt,
    actualPickupAt: task.actualPickupAt,
    handoverAt: task.handoverAt,
    recoveryPartner: task.recoveryPartner,
    recoveryVehicleLabel: task.recoveryVehicleLabel,
  }
}

export async function listPickups(req: Request, params: { status?: PickupTaskStatus; bookingType?: string }) {
  const tenantId = req.tenantId!
  const branchId = req.branchId
  const filter: Record<string, unknown> = {
    tenantId,
    ...(branchId && { branchId }),
    ...(params.status && { status: params.status }),
  }

  const tasks = await PickupTask.find(filter)
    .populate('bookingId', 'bookingNumber bookingType status pickupRequired')
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean()

  let items = tasks.map((t) => ({
    ...mapPickup(t as Parameters<typeof mapPickup>[0]),
    booking: t.bookingId,
  }))

  if (params.bookingType) {
    items = items.filter((i) => (i.booking as { bookingType?: string })?.bookingType === params.bookingType)
  }

  return { items }
}

export async function assignPickup(
  req: Request,
  id: string,
  data: {
    driverId: string
    recoveryVehicleLabel?: string
    recoveryPartner?: string
    scheduledPickupTime?: string
    dispatchNotes?: string
  },
) {
  const task = await PickupTask.findOne({ _id: id, tenantId: req.tenantId! })
  if (!task) throw new NotFoundError('Pickup task not found')

  task.driverId = data.driverId as unknown as typeof task.driverId
  task.recoveryVehicleLabel = data.recoveryVehicleLabel
  task.recoveryPartner = data.recoveryPartner
  task.scheduledPickupTime = data.scheduledPickupTime ? new Date(data.scheduledPickupTime) : undefined
  task.dispatchNotes = data.dispatchNotes
  task.status = 'ASSIGNED'
  task.assignedAt = new Date()
  task.assignedBy = req.user?.id as unknown as typeof task.assignedBy
  await task.save()

  const booking = await Booking.findById(task.bookingId)
  if (booking) {
    const from = normalizeBookingStatus(booking.status)
    if (from === 'AWAITING_PICKUP') {
      assertBookingStatusTransition(from, 'PICKUP_ASSIGNED')
      booking.status = 'PICKUP_ASSIGNED'
      await booking.save()
    }
  }

  return mapPickup(task.toObject())
}

export async function updatePickupStatus(req: Request, id: string, status: PickupTaskStatus) {
  const task = await PickupTask.findOne({ _id: id, tenantId: req.tenantId! })
  if (!task) throw new NotFoundError('Pickup task not found')

  if (status === 'IN_PROGRESS') task.actualArrivalAt = new Date()
  if (status === 'COMPLETED') {
    task.actualPickupAt = new Date()
    task.handoverAt = new Date()
  }

  task.status = status
  await task.save()

  const booking = await Booking.findById(task.bookingId)
  if (booking) {
    if (status === 'IN_PROGRESS' && normalizeBookingStatus(booking.status) === 'PICKUP_ASSIGNED') {
      assertBookingStatusTransition('PICKUP_ASSIGNED', 'PICKUP_IN_PROGRESS')
      booking.status = 'PICKUP_IN_PROGRESS'
      await booking.save()
    }
    if (status === 'COMPLETED') {
      const from = normalizeBookingStatus(booking.status)
      if (from === 'PICKUP_IN_PROGRESS') {
        assertBookingStatusTransition(from, 'AWAITING_GATE_IN')
        booking.status = 'AWAITING_GATE_IN'
        await booking.save()
      }
    }
  }

  return mapPickup(task.toObject())
}

export async function handoverPickup(req: Request, id: string, notes?: string) {
  const task = await PickupTask.findOne({ _id: id, tenantId: req.tenantId! })
  if (!task) throw new NotFoundError('Pickup task not found')
  if (task.status !== 'COMPLETED' && task.status !== 'IN_PROGRESS') {
    throw new ValidationError('Pickup must be in progress or completed before handover')
  }
  task.handoverAt = new Date()
  task.handoverNotes = notes
  await task.save()

  const booking = await Booking.findById(task.bookingId)
  if (booking && normalizeBookingStatus(booking.status) === 'PICKUP_IN_PROGRESS') {
    assertBookingStatusTransition('PICKUP_IN_PROGRESS', 'AWAITING_GATE_IN')
    booking.status = 'AWAITING_GATE_IN'
    await booking.save()
  }

  return mapPickup(task.toObject())
}
