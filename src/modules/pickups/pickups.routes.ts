import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import { PICKUP_TASK_STATUSES } from '../../types/enums.js'
import * as pickupsService from './pickups.service.js'

const router = Router()
router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', requirePermission('service_visits.view'), async (req, res, next) => {
  try {
    const status = req.query.status as typeof PICKUP_TASK_STATUSES[number] | undefined
    const bookingType = req.query.bookingType as string | undefined
    const data = await pickupsService.listPickups(req, { status, bookingType })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/assign', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const body = z.object({
      driverId: z.string().min(1),
      recoveryVehicleLabel: z.string().optional(),
      recoveryPartner: z.string().optional(),
      scheduledPickupTime: z.string().optional(),
      dispatchNotes: z.string().optional(),
    }).parse(req.body)
    const data = await pickupsService.assignPickup(req, String(req.params.id), body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/status', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(PICKUP_TASK_STATUSES),
    }).parse(req.body)
    const data = await pickupsService.updatePickupStatus(req, String(req.params.id), status)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/handover', requirePermission('service_visits.edit'), async (req, res, next) => {
  try {
    const { notes } = z.object({ notes: z.string().optional() }).parse(req.body ?? {})
    const data = await pickupsService.handoverPickup(req, String(req.params.id), notes)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
