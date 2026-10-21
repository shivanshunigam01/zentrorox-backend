import { z } from 'zod'

export const receivingDraftSchema = z.object({
  observedArrivalAt: z.union([z.string(), z.date()]).optional(),
  odometer: z.number().min(0).optional(),
  odometerUnit: z.enum(['KM', 'MILES']).optional(),
  fuelLevel: z.string().optional(),
  observedEngineNo: z.string().optional(),
  observedChassisNo: z.string().optional(),
  engineMatchStatus: z.enum(['MATCH', 'MISMATCH', 'UNREADABLE', 'NOT_CHECKED']).optional(),
  chassisMatchStatus: z.enum(['MATCH', 'MISMATCH', 'UNREADABLE', 'NOT_CHECKED']).optional(),
  verificationRemarks: z.string().optional(),
  keyReceived: z.boolean().optional(),
  keyCount: z.number().int().min(0).optional(),
  handoverPersonName: z.string().optional(),
  vehicleConditionRemarks: z.string().optional(),
  receivingRemarks: z.string().optional(),
  inventoryItems: z.array(z.object({
    _id: z.string().optional(),
    masterItemId: z.string().optional(),
    category: z.string().optional(),
    code: z.string().optional(),
    label: z.string(),
    status: z.enum(['PRESENT', 'MISSING', 'DAMAGED', 'NOT_APPLICABLE', 'NOT_CHECKED']),
    quantity: z.number().optional(),
    remarks: z.string().optional(),
    imageMediaId: z.string().optional(),
  })).optional(),
  exceptionFlags: z.array(z.string()).optional(),
  customerAcknowledged: z.boolean().optional(),
}).strict().partial()

export const completeReceivingSchema = z.object({
  idempotencyKey: z.string().max(128).optional(),
})
