// "Check for Enhancer updates": asks the store this editor installs extensions from for the
// latest published version, so the panel never announces a version the user's own store does
// not have yet. VS Code (and Insiders) install from the Visual Studio Marketplace; Cursor,
// Ornus, VSCodium and the other VS Code-based editors from Open VSX (or a mirror of it). The
// request carries nothing about the user; a missing listing or no network is quiet.
export type Store = 'marketplace' | 'openVsx'

/** The store of the editor whose `vscode.env.uriScheme` this is. */
export function storeFor (uriScheme: string): Store {
  return uriScheme === 'vscode' || uriScheme === 'vscode-insiders' ? 'marketplace' : 'openVsx'
}

/** One answer of the update check. `store` is where it came from: an answer from another store
 *  (earlier Enhancer versions always asked Open VSX) does not count, so it is asked again and never shown. */
export type UpdateCheck = { at: number; latest?: string; store?: Store }

/** The saved check when it was made against `store`. */
export function checkFrom (store: Store, check: UpdateCheck | undefined) {
  return check?.store === store ? check : undefined
}

export const OPEN_VSX_LATEST_URL = 'https://open-vsx.org/api/enhancer/enhancer-for-claude-code'
export const MARKETPLACE_QUERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'
/** The Marketplace query for this extension (filterType 7 = full id). Flags: 0x1 versions, 0x10
 *  their properties (to tell pre-releases apart), 0x10000 only the latest stable and pre-release
 *  version: the full history of a long-lived extension is far larger than the 64 KB answer cap
 *  (400 KB for ms-python.python, measured 2026-10-19). */
export const MARKETPLACE_QUERY = { filters: [{ criteria: [{ filterType: 7, value: 'enhancer.enhancer-for-claude-code' }] }], flags: 0x1 | 0x10 | 0x10000 }

/** The extension's page on each store's website, for editors that cannot open it themselves. */
export const STORE_PAGE: Record<Store, string> = {
  marketplace: 'https://marketplace.visualstudio.com/items?itemName=enhancer.enhancer-for-claude-code',
  openVsx: 'https://open-vsx.org/extension/enhancer/enhancer-for-claude-code',
}

const plainVersion = (version: unknown): version is string => typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version)

/** The `version` of an Open VSX extension answer, when it is a plain x.y.z. */
export function latestOpenVsxVersion (answer: unknown): string | undefined {
  const version = answer && typeof answer === 'object' ? (answer as { version?: unknown }).version : undefined
  return plainVersion(version) ? version : undefined
}

type MarketplaceVersion = { version?: unknown; properties?: { key?: unknown; value?: unknown }[] }

/** A version published as a pre-release: VS Code offers it only to users who chose pre-releases. */
const isPreRelease = (v: MarketplaceVersion) =>
  Array.isArray(v?.properties) && v.properties.some(p => p?.key === 'Microsoft.VisualStudio.Code.PreRelease' && p?.value === 'true')

/** The highest plain x.y.z among the stable versions of a Marketplace query answer. */
export function latestMarketplaceVersion (answer: unknown): string | undefined {
  const results = (answer as { results?: { extensions?: { versions?: MarketplaceVersion[] }[] }[] } | undefined)?.results
  const versions = Array.isArray(results) ? results[0]?.extensions?.[0]?.versions : undefined
  if (!Array.isArray(versions)) return undefined
  return versions.filter(v => !isPreRelease(v)).map(v => v?.version).filter(plainVersion)
    .reduce<string | undefined>((best, v) => !best || isNewer(v, best) ? v : best, undefined)
}

/** Asks `store` for the latest published version; undefined when it cannot tell. */
export async function latestVersionIn (store: Store): Promise<string | undefined> {
  if (store === 'openVsx') return latestOpenVsxVersion(await fetchJson(OPEN_VSX_LATEST_URL))
  return latestMarketplaceVersion(await fetchJson(MARKETPLACE_QUERY_URL, {
    body: MARKETPLACE_QUERY,
    accept: 'application/json;api-version=3.0-preview.1',
  }))
}

/** True when `candidate` (x.y.z) is a later release than `installed` (x.y.z). */
export function isNewer (candidate: string, installed: string) {
  const a = candidate.split('.').map(Number)
  const b = installed.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** GETs (or, with a `body`, POSTs) a small JSON document; undefined on any failure (offline,
 *  404, timeout, not JSON). */
export async function fetchJson (url: string, options: { body?: unknown; accept?: string; timeoutMs?: number } = {}): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: options.body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      headers: {
        accept: options.accept ?? 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    if (!response.ok) return undefined
    const text = await response.text()
    if (text.length > 64_000) return undefined
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
