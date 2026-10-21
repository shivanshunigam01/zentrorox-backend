import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { calculateLine, calculateEstimateTotals, roundMoney } from './estimate-calculation.js'

describe('estimate-calculation', () => {
  it('rounds currency to 2 decimals', () => {
    assert.equal(roundMoney(10.005), 10.01)
  })

  it('calculates CGST/SGST for intra-state', () => {
    const line = calculateLine({
      lineId: '1',
      category: 'PARTS',
      quantity: 2,
      unitRate: 100,
      useIgst: false,
      taxRule: { id: 't1', gstPercent: 18, cgstPercent: 9, sgstPercent: 9, igstPercent: 0 },
    })
    assert.equal(line.grossAmount, 200)
    assert.equal(line.cgstAmount, 18)
    assert.equal(line.sgstAmount, 18)
    assert.equal(line.igstAmount, 0)
    assert.equal(line.finalAmount, 236)
  })

  it('calculates IGST for inter-state', () => {
    const line = calculateLine({
      lineId: '2',
      category: 'LABOUR',
      quantity: 1,
      unitRate: 500,
      labourHours: 2,
      labourRate: 250,
      useIgst: true,
      taxRule: { id: 't2', gstPercent: 18, cgstPercent: 0, sgstPercent: 0, igstPercent: 18 },
    })
    assert.equal(line.grossAmount, 500)
    assert.equal(line.igstAmount, 90)
  })

  it('aggregates mixed lines', () => {
    const a = calculateLine({
      lineId: 'a',
      category: 'PARTS',
      quantity: 1,
      unitRate: 100,
      useIgst: false,
      taxRule: { id: 't', gstPercent: 18, cgstPercent: 9, sgstPercent: 9, igstPercent: 0 },
    })
    const totals = calculateEstimateTotals([a])
    assert.equal(totals.partsSubtotal, a.finalAmount)
    assert.ok(totals.finalAmount > 100)
  })
})
