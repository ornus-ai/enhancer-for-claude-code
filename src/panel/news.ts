// The Ornus news slot (plan §6): one short item from a small JSON file on ornus.ai,
// shown as plain text with one approved link, cached, and dismissible for good. Nothing
// from the file is ever run or rendered as HTML.
export const NEWS_URL = 'https://ornus.ai/enhancer/news.json'

export type NewsItem = {
  id: string
  title: { en: string; ar: string }
  text: { en: string; ar: string }
  url: string
  /** Last day shown (YYYY-MM-DD, UTC); kept so a cached item is dropped once it passes. */
  expires?: string
}

const MAX_TITLE = 60
const MAX_TEXT = 140
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/** An https link on ornus.ai (or a subdomain), with no credentials or odd port. */
export function isApprovedLink (value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  const host = url.hostname.toLowerCase()
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (host === 'ornus.ai' || host.endsWith('.ornus.ai'))
}

const shortText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

function bilingual (value: unknown, max: number): { en: string; ar: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { en, ar } = value as Record<string, unknown>
  return shortText(en, max) && shortText(ar, max) ? { en, ar } : undefined
}

/**
 * The valid items of a news file, in file order. An item is dropped when any field is
 * missing, too long or not approved, or when its `expires` date (YYYY-MM-DD, UTC) has passed.
 */
export function newsItemsFrom (file: unknown, now: Date): NewsItem[] {
  const items = file && typeof file === 'object' ? (file as { items?: unknown }).items : undefined
  if (!Array.isArray(items)) return []
  const today = now.toISOString().slice(0, 10)
  const out: NewsItem[] = []
  for (const raw of items.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !ID.test(item.id)) continue
    if (item.expires !== undefined && (typeof item.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.expires) || item.expires < today)) continue
    const title = bilingual(item.title, MAX_TITLE)
    const text = bilingual(item.text, MAX_TEXT)
    if (!title || !text || !isApprovedLink(item.url)) continue
    out.push(item.expires === undefined ? { id: item.id, title, text, url: item.url } : { id: item.id, title, text, url: item.url, expires: item.expires as string })
  }
  return out
}

/** The item to show: the first one the user has not dismissed. */
export const newsToShow = (items: readonly NewsItem[], dismissed: readonly string[]) =>
  items.find(item => !dismissed.includes(item.id))

/** The link opened from the slot, tagged with the campaign only (no per-user identifier). */
export function campaignLink (url: string) {
  const link = new URL(url)
  link.searchParams.set('utm_source', 'enhancer')
  link.searchParams.set('utm_medium', 'panel')
  return link.toString()
}

// Ornus is released (2026-10-28): the button leads to its download page (PLAN §7 Launch).
export const ORNUS_DOWNLOAD_URL = campaignLink('https://ornus.ai/download')
