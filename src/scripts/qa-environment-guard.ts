/**
 * Refuses to run QA-only scripts against databases that do not look like isolated QA/staging.
 */
export function assertQaDatabaseAllowed(): { databaseName: string } {
  const uri = process.env.MONGODB_URI ?? ''
  const match = uri.match(/\/([^/?]+)(\?|$)/)
  const databaseName = match?.[1] ?? ''
  const allow = process.env.ALLOW_QA_SEED === 'true'
  const qaLike = /qa|test|staging|sandbox/i.test(databaseName)

  if (!allow) {
    throw new Error(
      'QA seed blocked: set ALLOW_QA_SEED=true only when targeting an isolated QA MongoDB database.',
    )
  }
  if (!qaLike) {
    throw new Error(
      `QA seed blocked: database "${databaseName || '(unknown)'}" does not match qa|test|staging|sandbox. ` +
        'Point MONGODB_URI at a dedicated QA database (e.g. zentrorox-qa).',
    )
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('QA seed blocked: NODE_ENV=production')
  }

  return { databaseName }
}
