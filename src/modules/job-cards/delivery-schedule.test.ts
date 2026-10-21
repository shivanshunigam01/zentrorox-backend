import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calculateDeliverySchedule } from './delivery-schedule.js'

describe('calculateDeliverySchedule', () => {
  it('reduces elapsed hours with parallel teams', () => {
    const start = new Date('2026-01-10T09:00:00Z')
    const single = calculateDeliverySchedule({
      approvedLabourHours: 8,
      parallelTeams: 1,
      partsReady: true,
      plannedStart: start,
      bufferHours: 0,
      shiftHoursPerDay: 8,
    })
    const dual = calculateDeliverySchedule({
      approvedLabourHours: 8,
      parallelTeams: 2,
      partsReady: true,
      plannedStart: start,
      bufferHours: 0,
      shiftHoursPerDay: 8,
    })
    assert.ok(dual.estimatedDurationHours < single.estimatedDurationHours)
  })

  it('flags manager confirmation when parts not ready', () => {
    const r = calculateDeliverySchedule({
      approvedLabourHours: 4,
      parallelTeams: 1,
      partsReady: false,
      plannedStart: new Date(),
      bufferHours: 1,
      shiftHoursPerDay: 8,
    })
    assert.equal(r.requiresManagerConfirmation, true)
    assert.equal(r.delayRisk, 'HIGH')
  })
})
