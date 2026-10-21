/** Resource-aware delivery estimate (simplified — not a full APS engine). */

export type DeliveryScheduleInput = {
  approvedLabourHours: number
  parallelTeams: number
  partsReady: boolean
  earliestPartsDate?: Date
  plannedStart: Date
  bufferHours: number
  shiftHoursPerDay: number
}

export type DeliveryScheduleResult = {
  estimatedDurationHours: number
  earliestFeasibleCompletion: Date
  suggestedDelivery: Date
  requiresManagerConfirmation: boolean
  delayRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  note: string
}

export function calculateDeliverySchedule(input: DeliveryScheduleInput): DeliveryScheduleResult {
  const teams = Math.max(1, input.parallelTeams)
  const effectiveHours = input.approvedLabourHours / teams
  const durationHours = effectiveHours + input.bufferHours

  let start = new Date(input.plannedStart)
  if (input.earliestPartsDate && input.earliestPartsDate > start) {
    start = new Date(input.earliestPartsDate)
  }

  const finish = addWorkingHours(start, durationHours, input.shiftHoursPerDay)
  const partsRisk = !input.partsReady

  return {
    estimatedDurationHours: Math.round(durationHours * 100) / 100,
    earliestFeasibleCompletion: finish,
    suggestedDelivery: finish,
    requiresManagerConfirmation: partsRisk || input.approvedLabourHours <= 0,
    delayRisk: partsRisk ? 'HIGH' : durationHours > 16 ? 'MEDIUM' : 'LOW',
    note: partsRisk
      ? 'Parts availability may delay work — manager confirmation recommended.'
      : 'Estimate uses approved labour hours and team parallelism; not invoice-based.',
  }
}

function addWorkingHours(from: Date, hours: number, shiftHoursPerDay: number) {
  const shift = Math.max(1, shiftHoursPerDay)
  const d = new Date(from)
  let remaining = hours
  while (remaining > 0) {
    const chunk = Math.min(remaining, shift)
    d.setHours(d.getHours() + chunk)
    remaining -= chunk
  }
  return d
}
