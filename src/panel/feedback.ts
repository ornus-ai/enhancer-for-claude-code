// Feedback from the control panel: the user writes a suggestion or a problem and presses
// Send; the extension (never the webview) posts it to ornus.ai/enhancer/feedback, which
// forwards it to the owner's Telegram chat (src/feedbackWorker/worker.ts). Nothing is sent
// without that click, and the technical details go only when the user leaves them ticked.
// The request shape is shared with the worker: FeedbackRequest below is the contract.

export const FEEDBACK_URL = 'https://ornus.ai/enhancer/feedback'
export const FEEDBACK_TEXT_MAX = 2000
export const FEEDBACK_EMAIL_MAX = 254
/** Each technical detail is cut to this length; the worker refuses longer ones. */
export const FEEDBACK_DETAIL_MAX = 300

export const FEEDBACK_KINDS = ['suggestion', 'problem'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** What the user wrote in the form. */
export type FeedbackDraft = { kind: FeedbackKind; text: string; email: string; attach: boolean }

/** The technical details the form shows under "What is sent", built by the extension. */
export type FeedbackDetails = { extension: string; claudeCode: string; editor: string; os: string; features: string }

/** The body posted to the worker (version 1). `lang` goes with the details only. */
export type FeedbackRequest = {
  v: 1
  kind: FeedbackKind
  text: string
  email?: string
  lang?: string
  details?: FeedbackDetails
}

/** The text as sent: invisible control characters (other than line breaks and tabs) removed, trimmed. */
// eslint-disable-next-line no-control-regex
export const cleanFeedbackText = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()

/** One line naming each enhancement and how it stands: on, off, or waiting (with its reason). */
export function featuresSummary (rows: { id: string; on: boolean; active?: true; problem?: 'failed'; reason?: string }[]) {
  return rows.map(r => `${r.id} ${!r.on ? 'off' : r.problem ? `waiting${r.reason ? ` (${r.reason})` : ''}` : r.active ? 'on' : 'on, not yet applied'}`).join(', ')
}

/** `failed`: the message never got an answer (offline, timeout); `unavailable`: the server answered but could not take it. */
export type FeedbackResult = 'sent' | 'invalid' | 'rate' | 'daily' | 'unavailable' | 'failed'

/** A plain address check: something@something.tld, no spaces, at most 254 characters. */
export const isEmailLike = (value: string) => value.length <= FEEDBACK_EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

/** The draft is sendable: text present and within the limit; the email empty or address-like. */
export function isSendable (draft: FeedbackDraft) {
  const text = cleanFeedbackText(draft.text)
  const email = draft.email.trim()
  return text.length > 0 && text.length <= FEEDBACK_TEXT_MAX && (email === '' || isEmailLike(email))
}

const clip = (value: string) => value.length <= FEEDBACK_DETAIL_MAX ? value : value.slice(0, FEEDBACK_DETAIL_MAX - 1) + '…'
const clippedDetails = (d: FeedbackDetails): FeedbackDetails =>
  ({ extension: clip(d.extension), claudeCode: clip(d.claudeCode), editor: clip(d.editor), os: clip(d.os), features: clip(d.features) })

export function feedbackRequest (draft: FeedbackDraft, details: FeedbackDetails, lang: string): FeedbackRequest {
  const email = draft.email.trim()
  return {
    v: 1,
    kind: draft.kind,
    text: cleanFeedbackText(draft.text),
    ...(email ? { email } : {}),
    ...(draft.attach ? { lang, details: clippedDetails(details) } : {}),
  }
}

/** Posts the request; every failure (network, timeout, server) reads as a result, never a throw. */
export async function postFeedback (request: FeedbackRequest, fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<FeedbackResult> {
  try {
    const response = await fetchImpl(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.ok) return 'sent'
    if (response.status === 429) {
      // The worker says which limit: a few a minute ('rate') or the day's cap ('daily').
      const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined
      return body?.error === 'daily' ? 'daily' : 'rate'
    }
    if (response.status === 400) return 'invalid'
    return 'unavailable'
  } catch {
    return 'failed'
  }
}
