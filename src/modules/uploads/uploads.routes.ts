import { Router } from 'express'
import { z } from 'zod'
import { authenticate, requireTenant } from '../../middleware/auth.js'
import { upload } from '../../middleware/upload.js'
import * as uploadsService from './uploads.service.js'
import * as serviceVisitsService from '../service-visits/service-visits.service.js'

const router = Router()

router.use(authenticate, requireTenant)

router.post('/image', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded' } })
      return
    }

    const body = z.object({
      folder: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      tags: z.string().optional(),
    }).parse(req.body)

    const result = await uploadsService.uploadImageBuffer(req, req.file, {
      folder: body.folder,
      entityType: body.entityType,
      entityId: body.entityId,
      tags: body.tags ? body.tags.split(',').map((t) => t.trim()) : undefined,
    })

    res.status(201).json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post('/images', upload.array('files', 10), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[]
    if (!files?.length) {
      res.status(400).json({ success: false, error: { code: 'NO_FILES', message: 'No files uploaded' } })
      return
    }

    const body = z.object({
      folder: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
    }).parse(req.body)

    const results = await uploadsService.uploadMultipleImages(req, files, body)
    res.status(201).json({ success: true, data: results })
  } catch (err) {
    next(err)
  }
})

router.post('/service-visits/:id/inspection', upload.array('files', 10), async (req, res, next) => {
  try {
    const files = req.files as Express.Multer.File[]
    if (!files?.length) {
      res.status(400).json({ success: false, error: { code: 'NO_FILES', message: 'No files uploaded' } })
      return
    }

    const id = String(req.params.id)
    const caption = typeof req.body.caption === 'string' ? req.body.caption : undefined

    const uploads = await uploadsService.uploadMultipleImages(req, files, {
      folder: `inspections/${id}`,
      entityType: 'service_visit',
      entityId: id,
      tags: ['inspection'],
    })

    for (const img of uploads) {
      await serviceVisitsService.addInspectionImage(req, id, {
        url: img.url,
        publicId: img.publicId,
        caption,
      })
    }

    res.status(201).json({ success: true, data: uploads })
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.query
    const data = await uploadsService.listMedia(
      req,
      entityType as string | undefined,
      entityId as string | undefined,
    )
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.delete('/:publicId', async (req, res, next) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId)
    const data = await uploadsService.deleteImage(req, publicId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

export default router
