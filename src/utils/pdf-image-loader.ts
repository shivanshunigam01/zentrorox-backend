import { env } from '../config/env.js'

const MAX_BYTES = 1_500_000
const FETCH_TIMEOUT_MS = 15_000

export type PdfImageSlot = {
  caption?: string
  url?: string
  publicId?: string
}

export type LoadedPdfImage = {
  caption?: string
  buffer?: Buffer
  mime?: string
  error?: string
}

function cloudinaryTransformUrl(url: string, publicId?: string): string {
  if (!env.CLOUDINARY_CLOUD_NAME && !url.includes('cloudinary.com')) return url
  if (publicId && env.CLOUDINARY_CLOUD_NAME) {
    return `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/w_480,q_65,f_auto/${publicId}`
  }
  if (url.includes('/upload/') && !url.includes('/upload/w_')) {
    return url.replace('/upload/', '/upload/w_480,q_65,f_auto/')
  }
  return url
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function loadImageForPdf(slot: PdfImageSlot, attempt = 0): Promise<LoadedPdfImage> {
  const caption = slot.caption
  const url = slot.url ? cloudinaryTransformUrl(slot.url, slot.publicId) : undefined
  if (!url) {
    return { caption, error: 'Image not available' }
  }
  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      if (attempt < 1) return loadImageForPdf(slot, attempt + 1)
      return { caption, error: `HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) {
      return { caption, error: 'Image exceeds PDF size limit' }
    }
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    if (!mime.startsWith('image/')) {
      return { caption, error: 'Not an image' }
    }
    return { caption, buffer: buf, mime }
  } catch (e) {
    if (attempt < 1) return loadImageForPdf(slot, attempt + 1)
    return { caption, error: e instanceof Error ? e.message : 'Fetch failed' }
  }
}

export async function loadImagesForPdf(slots: PdfImageSlot[]): Promise<LoadedPdfImage[]> {
  const limited = slots.slice(0, 12)
  return Promise.all(limited.map((s) => loadImageForPdf(s)))
}
