import { ValidationError } from '../../utils/errors.js'
import type { BookingStatus } from '../../types/enums.js'

const ALLOWED: Partial<Record<BookingStatus, BookingStatus[]>> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['AWAITING_PICKUP', 'AWAITING_GATE_IN', 'CANCELLED', 'NO_SHOW'],
  AWAITING_PICKUP: ['PICKUP_ASSIGNED', 'CANCELLED', 'NO_SHOW'],
  PICKUP_ASSIGNED: ['PICKUP_IN_PROGRESS', 'AWAITING_PICKUP', 'CANCELLED'],
  PICKUP_IN_PROGRESS: ['AWAITING_GATE_IN', 'CANCELLED'],
  AWAITING_GATE_IN: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: [],
  CANCELLED: [],
  NO_SHOW: [],
  BOOKED: ['CONFIRMED', 'CANCELLED', 'AWAITING_PICKUP', 'AWAITING_GATE_IN'],
  RESCHEDULED: ['CONFIRMED', 'CANCELLED', 'AWAITING_PICKUP', 'AWAITING_GATE_IN'],
  ARRIVED: ['CHECKED_IN'],
}

export function assertBookingStatusTransition(from: BookingStatus, to: BookingStatus) {
  if (from === to) return
  const allowed = ALLOWED[from]
  if (!allowed?.includes(to)) {
    throw new ValidationError(`Invalid booking status transition: ${from} → ${to}`)
  }
}
