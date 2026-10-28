// Cloudflare Worker on ornus.ai/enhancer/feedback: takes one feedback message from the
// Enhancer control panel (src/panel/feedback.ts, FeedbackRequest v1) and forwards it to the
// owner's Telegram chat. It stores nothing; the sender's address is used only by the rate
// limits. Deployed with wrangler from this folder (see wrangler.toml); not shipped in the
// extension package.
//
// Answers: 200 {ok:true} delivered · 400 invalid body · 405 not POST · 413 too large ·
// 415 not JSON · 429 rate limited · 502 Telegram did not take it · 503 not configured.
//
// Abuse: the body must be application/json, so a web page cannot post here from a browser
// without a CORS preflight, which this worker never grants. The body is read in pieces and
// dropped past 8 KB. Each sender (an IPv4 address, or an IPv6 /64, the block one machine
// usually holds) may send a few messages a minute, and all senders together a bounded
// number. Cloudflare counts these limits per data centre, so senders spread over many
// places can pass more; Telegram's own limit per chat (about one message a second) stays
// the hard ceiling. Feedback goes to a chat of its own, apart from the owner's alerts.
//
// Repeats and daily cap (owner, 2026-10-18): a message whose text matches one delivered in
// the last REPEAT_WINDOW_S is answered "ok" and dropped quietly (a spammer learns nothing);
// each sender may have DAILY_LIMIT messages delivered a UTC day, then gets 429 "daily".
// Both live in KV. Known limits (review rv-221bd14a R2/R3, accepted): the count is read then
// written, not atomic, so two sends at the same instant may both pass (a Durable Object
// would make it exact); if KV fails (down, or its write quota used up) feedback still flows
// under the per-minute limits rather than being lost, so the daily cap pauses meanwhile.

export const BODY_MAX_BYTES = 8 * 1024
const TEXT_MAX = 2000
const EMAIL_MAX = 254
const DETAIL_MAX = 300
export const DAILY_LIMIT = 10
export const REPEAT_WINDOW_S = 60 * 60

export type RateLimiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> }

/** The part of Workers KV the worker uses. */
export type Memory = {
  get: (key: string) => Promise<string | null>
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>
}

export type FeedbackEnv = {
  /** Recent message fingerprints and each sender's daily count (wrangler.toml [[kv_namespaces]]). */
  FEEDBACK_MEMORY?: Memory
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  /** Per sender address (wrangler.toml [[ratelimits]] PER_SENDER). */
  PER_SENDER: RateLimiter
  /** All senders together (wrangler.toml [[ratelimits]] ALL_SENDERS). */
  ALL_SENDERS: RateLimiter
}

type Kind = 'suggestion' | 'problem'
type Details = { extension: string; claudeCode: string; editor: string; os: string; features: string }
export type ValidFeedback = { kind: Kind; text: string; email?: string; lang?: string; details?: Details }

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const isShortText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
// Control characters other than line breaks and tabs are refused in the message text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/** The request body as a valid feedback, or undefined when any field breaks the contract. */
export function validFeedback (raw: unknown): ValidFeedback | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const body = raw as Record<string, unknown>
  if (body.v !== 1) return undefined
  if (body.kind !== 'suggestion' && body.kind !== 'problem') return undefined
  if (typeof body.text !== 'string') return undefined
  const text = body.text.trim()
  if (text.length === 0 || text.length > TEXT_MAX || CONTROL.test(text)) return undefined
  const result: ValidFeedback = { kind: body.kind, text }
  if (body.lang !== undefined) {
    if (!isShortText(body.lang, 10) || !/^[a-z]{2}(-[a-z]{2})?$/.test(body.lang)) return undefined
    result.lang = body.lang
  }
  if (body.email !== undefined) {
    if (!isShortText(body.email, EMAIL_MAX) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return undefined
    result.email = body.email
  }
  if (body.details !== undefined) {
    const d = body.details as Record<string, unknown>
    if (!d || typeof d !== 'object' || Array.isArray(d)) return undefined
    const keys = ['extension', 'claudeCode', 'editor', 'os', 'features'] as const
    if (!keys.every(k => isShortText(d[k], DETAIL_MAX) && !CONTROL.test(d[k] as string))) return undefined
    result.details = { extension: d.extension, claudeCode: d.claudeCode, editor: d.editor, os: d.os, features: d.features } as Details
  }
  return result
}

/** The Telegram message: plain text (no parse mode), so nothing the user wrote is read as markup. */
export function telegramText (feedback: ValidFeedback) {
  const head = feedback.kind === 'problem' ? '🐞 Enhancer — مشكلة' : '💡 Enhancer — اقتراح'
  const lines = [head, '', feedback.text, '']
  if (feedback.lang) lines.push(`Language: ${feedback.lang}`)
  if (feedback.email) lines.push(`Reply to: ${feedback.email}`)
  if (feedback.details) {
    const d = feedback.details
    lines.push(`Enhancer ${d.extension} · Claude Code ${d.claudeCode}`, `${d.editor} · ${d.os}`, `Enhancements: ${d.features}`)
  }
  return lines.join('\n').trimEnd()
}

/** The body, read piece by piece and given up as soon as it passes BODY_MAX_BYTES (undefined then). */
async function readCapped (request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > BODY_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return undefined
    }
    parts.push(value)
  }
  const body = new Uint8Array(size)
  let at = 0
  for (const part of parts) { body.set(part, at); at += part.byteLength }
  return body
}

/** What the per-sender limit counts: an IPv4 address as is, an IPv6 address by its /64 block. */
export function senderKey (address: string) {
  if (!address.includes(':')) return address
  // An IPv4 address written as IPv6 (::ffff:1.2.3.4) counts as that IPv4 address.
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (mapped) return mapped[1]
  const [head, tail = ''] = address.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = address.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64'
}

/** The same message however it is spaced or cased: the repeat filter's fingerprint. */
async function fingerprintOf (text: string) {
  const normal = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normal))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** Runs a memory step; a failing KV is logged and treated as "nothing remembered". */
async function remembered<T> (step: () => Promise<T>, fallback: T): Promise<T> {
  try { return await step() } catch (error) {
    console.log(`feedback memory unavailable: ${(error as Error).message}`)
    return fallback
  }
}

export async function handleFeedback (request: Request, env: FeedbackEnv, fetchImpl: typeof fetch = fetch, now = new Date()): Promise<Response> {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method' })
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type !== 'application/json') return json(415, { ok: false, error: 'type' })
  const declared = request.headers.get('content-length')
  if (declared !== null && !(Number(declared) <= BODY_MAX_BYTES)) return json(413, { ok: false, error: 'size' })
  const raw = await readCapped(request)
  if (!raw) return json(413, { ok: false, error: 'size' })

  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { return json(400, { ok: false, error: 'invalid' }) }
  const feedback = validFeedback(parsed)
  if (!feedback) return json(400, { ok: false, error: 'invalid' })

  const sender = senderKey(request.headers.get('cf-connecting-ip') ?? 'unknown')
  if (!(await env.PER_SENDER.limit({ key: sender })).success) return json(429, { ok: false, error: 'rate' })
  if (!(await env.ALL_SENDERS.limit({ key: 'all' })).success) return json(429, { ok: false, error: 'rate' })

  const memory = env.FEEDBACK_MEMORY
  const repeatKey = `repeat:${await fingerprintOf(feedback.text)}`
  if (memory && await remembered(() => memory.get(repeatKey), null) !== null) return json(200, { ok: true })
  const dayKey = `day:${now.toISOString().slice(0, 10)}:${sender}`
  const sentToday = memory ? Number(await remembered(() => memory.get(dayKey), '0')) || 0 : 0
  if (sentToday >= DAILY_LIMIT) return json(429, { ok: false, error: 'daily' })

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json(503, { ok: false, error: 'not-configured' })
  try {
    const sent = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: telegramText(feedback), disable_web_page_preview: true }),
    })
    if (!sent.ok) return json(502, { ok: false, error: 'deliver' })
  } catch {
    return json(502, { ok: false, error: 'deliver' })
  }
  // Counted and remembered only once delivered: a failed send uses up no part of the day, and
  // its retry is not taken for a repeat.
  if (memory) {
    await remembered(() => memory.put(dayKey, String(sentToday + 1), { expirationTtl: 2 * 24 * 60 * 60 }), undefined)
    await remembered(() => memory.put(repeatKey, '1', { expirationTtl: REPEAT_WINDOW_S }), undefined)
  }
  return json(200, { ok: true })
}

export default {
  fetch: (request: Request, env: FeedbackEnv) => handleFeedback(request, env),
}
