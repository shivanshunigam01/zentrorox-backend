import nodemailer from 'nodemailer'

export type NotifyResult = {
  status: 'SENT' | 'FAILED' | 'NOT_CONFIGURED'
  providerReference?: string
  errorDetails?: string
}

function stripEnvQuotes(value: string | undefined): string | undefined {
  if (!value) return undefined
  const t = value.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim())
}

async function sendViaSmtp(params: {
  to: string
  subject: string
  text: string
  html?: string
  attachment?: { filename: string; content: Buffer; contentType: string }
}): Promise<NotifyResult> {
  const host = process.env.SMTP_HOST!.trim()
  const port = Number(process.env.SMTP_PORT ?? 587)
  const secure = process.env.SMTP_SECURE === 'true'
  const user = process.env.SMTP_USER!.trim()
  const pass = process.env.SMTP_PASS!.replace(/\s/g, '')
  const from =
    stripEnvQuotes(process.env.SMTP_FROM) ??
    stripEnvQuotes(process.env.EMAIL_FROM) ??
    user

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  })

  try {
    const info = await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: params.attachment
        ? [{ filename: params.attachment.filename, content: params.attachment.content, contentType: params.attachment.contentType }]
        : undefined,
    })
    return { status: 'SENT', providerReference: info.messageId ?? `smtp-${Date.now()}` }
  } catch (e) {
    return { status: 'FAILED', errorDetails: e instanceof Error ? e.message : 'SMTP send failed' }
  }
}

async function sendViaSendGrid(params: {
  to: string
  subject: string
  text: string
  html?: string
  attachment?: { filename: string; content: Buffer; contentType: string }
}): Promise<NotifyResult> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim()
  const from = stripEnvQuotes(process.env.EMAIL_FROM) ?? stripEnvQuotes(process.env.SMTP_FROM)
  if (!apiKey || !from) {
    return {
      status: 'NOT_CONFIGURED',
      errorDetails: 'Set SMTP_* (Nodemailer) or SENDGRID_API_KEY and EMAIL_FROM.',
    }
  }

  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: params.to }] }],
    from: { email: from.includes('<') ? from.match(/<([^>]+)>/)?.[1] ?? from : from },
    subject: params.subject,
    content: [
      { type: 'text/plain', value: params.text },
      ...(params.html ? [{ type: 'text/html', value: params.html }] : []),
    ],
  }
  if (params.attachment) {
    body.attachments = [
      {
        content: params.attachment.content.toString('base64'),
        filename: params.attachment.filename,
        type: params.attachment.contentType,
        disposition: 'attachment',
      },
    ]
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (res.status >= 200 && res.status < 300) {
      return { status: 'SENT', providerReference: `sendgrid-${res.headers.get('x-message-id') ?? Date.now()}` }
    }
    const errText = await res.text()
    return { status: 'FAILED', errorDetails: `SendGrid ${res.status}: ${errText.slice(0, 500)}` }
  } catch (e) {
    return { status: 'FAILED', errorDetails: e instanceof Error ? e.message : 'Email send failed' }
  }
}

export async function sendTransactionalEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
  attachment?: { filename: string; content: Buffer; contentType: string }
}): Promise<NotifyResult> {
  if (smtpConfigured()) {
    return sendViaSmtp(params)
  }
  if (process.env.SENDGRID_API_KEY?.trim()) {
    return sendViaSendGrid(params)
  }
  return {
    status: 'NOT_CONFIGURED',
    errorDetails: 'Set SMTP_HOST, SMTP_USER, SMTP_PASS (and SMTP_FROM) or SENDGRID_API_KEY.',
  }
}

export async function sendWhatsAppNotify(params: {
  to: string
  body: string
  mediaUrl?: string
}): Promise<NotifyResult> {
  const url = process.env.WHATSAPP_NOTIFY_URL?.trim()
  const token = process.env.WHATSAPP_API_TOKEN?.trim()
  if (!url) {
    return {
      status: 'NOT_CONFIGURED',
      errorDetails: 'Set WHATSAPP_NOTIFY_URL to your approved WhatsApp Business / ZentroBOT webhook.',
    }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        to: params.to,
        message: params.body,
        mediaUrl: params.mediaUrl,
      }),
    })
    const payload = await res.json().catch(() => ({})) as { messageId?: string; id?: string; error?: string }
    if (!res.ok) {
      return { status: 'FAILED', errorDetails: payload.error ?? `HTTP ${res.status}` }
    }
    return { status: 'SENT', providerReference: payload.messageId ?? payload.id ?? `wa-${Date.now()}` }
  } catch (e) {
    return { status: 'FAILED', errorDetails: e instanceof Error ? e.message : 'WhatsApp send failed' }
  }
}
