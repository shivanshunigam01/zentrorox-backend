import { Router } from 'express'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { enforceTenantScope } from '../../middleware/tenant-isolation.js'
import * as jobCardsService from './job-cards.service.js'

const router = Router()

router.use(authenticate, requireTenant, enforceTenantScope)

router.get('/', async (req, res, next) => {
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

router.get('/by-visit/:visitId', async (req, res, next) => {
  try {
    const data = await jobCardsService.getJobCardByVisit(req, req.params.visitId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const data = await jobCardsService.getJobCard(req, req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
