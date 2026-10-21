import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requirePermission, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as jobCardsService from './job-cards.service.js'
import * as phase5 from './job-cards-phase5.service.js'
import * as workshop from './workshop-resources.service.js'
import * as revisionService from './job-card-revision.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/dashboard', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await phase5.getJobCardDashboard(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/queue', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await phase5.getJobCardQueue(req, {
      tab: req.query.tab as string | undefined,
      search: req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/masters/teams', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await workshop.listWorkshopTeams(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/masters/locations', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await workshop.listWorkshopLocations(req)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/masters/eligible-employees', requirePermission('job_cards.assign'), async (req, res, next) => {
  try {
    const data = await workshop.listEligibleEmployees(req, {
      role: req.query.role as string | undefined,
      skill: req.query.skill as string | undefined,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/locations/availability', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const from = new Date(String(req.query.from ?? Date.now()))
    const to = new Date(String(req.query.to ?? Date.now() + 86400000))
    const data = await workshop.getLocationAvailability(req, from, to)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/locations/reservations', requirePermission('job_cards.assign'), async (req, res, next) => {
  try {
    const body = z.object({
      locationId: z.string(),
      jobCardId: z.string(),
      assignmentId: z.string().optional(),
      plannedStart: z.string(),
      plannedEnd: z.string(),
      remarks: z.string().optional(),
    }).parse(req.body)
    const data = await workshop.createLocationReservation(req, body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/from-visit/:visitId', requirePermission('job_cards.create'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await phase5.createJobCardFromVisit(req, String(req.params.visitId), key)
    res.status(data.duplicate ? 200 : 201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await jobCardsService.listJobCards(req, {
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/by-visit/:visitId', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await jobCardsService.getJobCardByVisit(req, String(req.params.visitId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/workspace', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await phase5.getJobCardWorkspace(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/pdf', requirePermission('job_cards.print'), async (req, res, next) => {
  try {
    const { buffer, filename } = await phase5.getJobCardPdf(req, String(req.params.id))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    res.send(buffer)
  } catch (err) {
    next(err)
  }
})

router.post('/:id/assignments', requirePermission('job_cards.assign'), async (req, res, next) => {
  try {
    const data = await phase5.createAssignment(req, String(req.params.id), req.body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/assignments/:assignmentId/release', requirePermission('job_cards.release'), async (req, res, next) => {
  try {
    const data = await phase5.releaseAssignment(req, String(req.params.id), String(req.params.assignmentId))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/revisions', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await revisionService.listRevisions(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/revisions/from-approval', requirePermission('job_cards.revise'), async (req, res, next) => {
  try {
    const key = req.headers['idempotency-key'] as string | undefined
    const data = await revisionService.createRevisionFromApproval(req, String(req.params.id), req.body, key)
    res.status(data.duplicate ? 200 : 201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/delivery-plan', requirePermission('delivery_commitments.create'), async (req, res, next) => {
  try {
    const data = await phase5.updateDeliveryPlan(req, String(req.params.id), req.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', requirePermission('job_cards.view'), async (req, res, next) => {
  try {
    const data = await jobCardsService.getJobCard(req, String(req.params.id))
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
