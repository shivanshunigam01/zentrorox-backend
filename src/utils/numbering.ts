import { NumberingSeries } from '../models/index.js'

export async function generateDocumentNumber(
  tenantId: string,
  module: string,
  branchCode?: string,
): Promise<string> {
  const series = await NumberingSeries.findOneAndUpdate(
    { tenantId, module },
    { $inc: { currentNo: 1 } },
    { new: true, upsert: false },
  )

  if (!series) {
    throw new Error(`Numbering series not configured for module: ${module}`)
  }

  const now = new Date()
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const seq = String(series.currentNo).padStart(series.padLength, '0')

  let number = series.prefix
  if (branchCode) number += `-${branchCode}`
  if (series.includeYearMonth) number += `-${yearMonth}`
  number += `-${seq}`
  if (series.suffix) number += series.suffix

  return number
}
