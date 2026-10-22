/** Normalize org codes: trim, uppercase, spaces/underscores → hyphen (e.g. "demo motors" → "DEMO-MOTORS"). */
export function normalizeTenantCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s_]+/g, '-')
}
