import { Readable } from 'stream'
import { cloudinary, configureCloudinary, isCloudinaryConfigured } from '../../lib/cloudinary.js'
import { Media } from '../../models/index.js'
import { env } from '../../config/env.js'
import { ValidationError } from '../../utils/errors.js'
import type { Request } from 'express'

interface UploadOptions {
  folder?: string
  tags?: string[]
  entityType?: string
  entityId?: string
}

function bufferToStream(buffer: Buffer) {
  const readable = new Readable()
  readable.push(buffer)
  readable.push(null)
  return readable
}

export async function uploadImageBuffer(
  req: Request,
  file: Express.Multer.File,
  options: UploadOptions = {},
) {
  if (!isCloudinaryConfigured()) {
    throw new ValidationError(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env',
    )
  }

  configureCloudinary()

  const tenantId = req.tenantId!
  const folder = options.folder ?? `${env.CLOUDINARY_FOLDER}/${tenantId}`

  const result = await new Promise<{
    secure_url: string
    public_id: string
    format: string
    bytes: number
    width: number
    height: number
    resource_type: string
  }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        tags: ['zentrosure', tenantId, ...(options.tags ?? [])],
      },
      (error, uploadResult) => {
        if (error || !uploadResult) reject(error ?? new Error('Upload failed'))
        else resolve(uploadResult as typeof uploadResult & { secure_url: string })
      },
    )
    bufferToStream(file.buffer).pipe(uploadStream)
  })

  const media = await Media.create({
    tenantId,
    uploadedBy: req.user?.id,
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
    folder,
    tags: options.tags,
    entityType: options.entityType,
    entityId: options.entityId,
  })

  return {
    id: media._id.toString(),
    url: media.url,
    publicId: media.publicId,
    format: media.format,
    width: media.width,
    height: media.height,
    bytes: media.bytes,
  }
}

export async function uploadMultipleImages(
  req: Request,
  files: Express.Multer.File[],
  options: UploadOptions = {},
) {
  const uploads = await Promise.all(
    files.map((file) => uploadImageBuffer(req, file, options)),
  )
  return uploads
}

export async function deleteImage(req: Request, publicId: string) {
  if (!isCloudinaryConfigured()) {
    throw new ValidationError('Cloudinary is not configured')
  }

  configureCloudinary()

  await cloudinary.uploader.destroy(publicId)

  await Media.deleteOne({ tenantId: req.tenantId!, publicId })

  return { deleted: true, publicId }
}

export async function listMedia(req: Request, entityType?: string, entityId?: string) {
  const filter: Record<string, unknown> = { tenantId: req.tenantId! }
  if (entityType) filter.entityType = entityType
  if (entityId) filter.entityId = entityId

  const items = await Media.find(filter).sort({ createdAt: -1 }).limit(50).lean()

  return items.map((m) => ({
    id: m._id.toString(),
    url: m.url,
    publicId: m.publicId,
    format: m.format,
    entityType: m.entityType,
    entityId: m.entityId,
    createdAt: m.createdAt,
  }))
}
