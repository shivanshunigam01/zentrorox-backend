import type { EInvoicePayload } from './e-invoice-payload.js'

export type EInvoiceProviderResult = {
  success: boolean
  irn?: string
  ackNo?: string
  ackDate?: Date
  signedQrCode?: string
  providerReference?: string
  errorCode?: string
  errorMessage?: string
}

export interface EInvoiceProvider {
  name: string
  generateIrn(payload: EInvoicePayload): Promise<EInvoiceProviderResult>
  cancelIrn(irn: string, reason: string): Promise<EInvoiceProviderResult>
}

export class GspHttpEInvoiceProvider implements EInvoiceProvider {
  name = 'GSP_HTTP'

  constructor(
    private readonly config: {
      baseUrl: string
      clientId: string
      clientSecret: string
    },
  ) {}

  async generateIrn(payload: EInvoicePayload): Promise<EInvoiceProviderResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/einvoice/generate`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': this.config.clientId,
        'X-Client-Secret': this.config.clientSecret,
      },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        success: false,
        errorCode: String(body.code ?? res.status),
        errorMessage: String(body.message ?? 'GSP e-invoice request failed'),
      }
    }
    if (!body.irn || typeof body.irn !== 'string') {
      return {
        success: false,
        errorMessage: 'GSP response missing IRN — invoice cannot be marked compliant',
      }
    }
    return {
      success: true,
      irn: body.irn as string,
      ackNo: body.ackNo as string | undefined,
      ackDate: body.ackDate ? new Date(String(body.ackDate)) : undefined,
      signedQrCode: body.signedQrCode as string | undefined,
      providerReference: body.reference as string | undefined,
    }
  }

  async cancelIrn(irn: string, reason: string): Promise<EInvoiceProviderResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/einvoice/cancel`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': this.config.clientId,
        'X-Client-Secret': this.config.clientSecret,
      },
      body: JSON.stringify({ irn, reason }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        success: false,
        errorMessage: String(body.message ?? 'Cancel failed'),
      }
    }
    return { success: true, providerReference: body.reference as string | undefined }
  }
}

/** Test-only provider — never used when NODE_ENV=production. */
export class MockEInvoiceProvider implements EInvoiceProvider {
  name = 'MOCK'

  async generateIrn(): Promise<EInvoiceProviderResult> {
    return {
      success: false,
      errorMessage: 'Mock provider does not emit IRNs — use GSP_HTTP with authorized credentials',
    }
  }

  async cancelIrn(): Promise<EInvoiceProviderResult> {
    return { success: false, errorMessage: 'Mock provider cannot cancel IRNs' }
  }
}

export function resolveEInvoiceProvider(): EInvoiceProvider | null {
  const provider = (process.env.EINVOICE_PROVIDER ?? 'GSP_HTTP').trim()
  if (process.env.NODE_ENV === 'production' && provider === 'MOCK') {
    return null
  }
  if (provider === 'MOCK') {
    return new MockEInvoiceProvider()
  }
  const baseUrl = process.env.EINVOICE_GSP_BASE_URL?.trim()
  const clientId = process.env.EINVOICE_GSP_CLIENT_ID?.trim()
  const clientSecret = process.env.EINVOICE_GSP_CLIENT_SECRET?.trim()
  if (!baseUrl || !clientId || !clientSecret) return null
  return new GspHttpEInvoiceProvider({ baseUrl, clientId, clientSecret })
}
