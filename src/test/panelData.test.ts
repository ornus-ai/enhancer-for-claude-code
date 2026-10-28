import * as assert from 'assert/strict'
import { describe, test } from 'node:test'

import { turnedOnFrom } from '../features.ts'
import { parsePanelMessage } from '../panel/messages.ts'
import { ORNUS_DOWNLOAD_URL, campaignLink, isApprovedLink, newsItemsFrom, newsToShow } from '../panel/news.ts'
import { checkFrom, isNewer, latestMarketplaceVersion, latestOpenVsxVersion, storeFor } from '../panel/updates.ts'

const NOW = new Date('2026-10-17T12:00:00Z')
const good = {
  id: 'launch-1',
  title: { en: 'Ornus is out', ar: 'Ornus متاح' },
  text: { en: 'A workspace for building with AI.', ar: 'مساحة عمل للبناء بالذكاء الاصطناعي.' },
  url: 'https://ornus.ai/download',
}

describe('Ornus news', () => {
  test('a well-formed item is kept as is', () => {
    assert.deepEqual(newsItemsFrom({ items: [good] }, NOW), [good])
  })

  test('links outside ornus.ai, plain http, credentials or a port are refused', () => {
    for (const url of ['https://evil.example/x', 'http://ornus.ai/x', 'https://ornus.ai.evil.example/', 'https://user:pw@ornus.ai/',
      'https://ornus.ai:8443/', 'javascript:alert(1)', 'https://notornus.ai/']) {
      assert.equal(isApprovedLink(url), false, url)
      assert.deepEqual(newsItemsFrom({ items: [{ ...good, url }] }, NOW), [], url)
    }
    assert.equal(isApprovedLink('https://www.ornus.ai/a?b=1'), true)
  })

  test('a link that is not text is refused, even one that reads as an ornus.ai address', () => {
    assert.equal(isApprovedLink(['https://ornus.ai/']), false)
    assert.equal(isApprovedLink({ toString: () => 'https://ornus.ai/' }), false)
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, url: ['https://ornus.ai/'] }] }, NOW), [])
  })

  test('a broken item (empty title or text) is skipped and the good ones still come through', () => {
    const second = { ...good, id: 'launch-2' }
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, title: null }, { ...good, text: null }, second] }, NOW), [second])
  })

  test('items missing a language, too long, or with a bad id are dropped', () => {
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, title: { en: 'Only English' } }] }, NOW), [])
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, title: { en: 'x'.repeat(61), ar: 'y' } }] }, NOW), [])
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, text: { en: 'x'.repeat(141), ar: 'y' } }] }, NOW), [])
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, id: 'Has Spaces' }] }, NOW), [])
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, text: { en: '   ', ar: 'y' } }] }, NOW), [])
  })

  test('an item past its date is dropped; one expiring today still shows', () => {
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, expires: '2026-10-16' }] }, NOW), [])
    assert.equal(newsItemsFrom({ items: [{ ...good, expires: '2026-10-17' }] }, NOW).length, 1)
    assert.deepEqual(newsItemsFrom({ items: [{ ...good, expires: 'soon' }] }, NOW), [])
  })

  test('a cached item keeps its date, so reading the cache after that date drops it', () => {
    const cached = newsItemsFrom({ items: [{ ...good, expires: '2026-10-20' }] }, NOW)
    assert.equal(cached[0].expires, '2026-10-20')
    assert.equal(newsItemsFrom({ items: cached }, new Date('2026-10-20T23:00:00Z')).length, 1)
    assert.deepEqual(newsItemsFrom({ items: cached }, new Date('2026-10-21T00:30:00Z')), [])
  })

  test('a file that is not the expected shape gives no items', () => {
    for (const file of [undefined, null, 'text', 42, {}, { items: 'x' }, { items: [null, 3, 'a'] }]) {
      assert.deepEqual(newsItemsFrom(file, NOW), [])
    }
  })

  test('a dismissed item is skipped for the next one', () => {
    const second = { ...good, id: 'launch-2' }
    assert.equal(newsToShow([good, second], ['launch-1'])?.id, 'launch-2')
    assert.equal(newsToShow([good, second], ['launch-1', 'launch-2']), undefined)
  })

  test('links carry the campaign only', () => {
    assert.equal(campaignLink('https://ornus.ai/download?x=1'), 'https://ornus.ai/download?x=1&utm_source=enhancer&utm_medium=panel')
    assert.equal(ORNUS_DOWNLOAD_URL, 'https://ornus.ai/download?utm_source=enhancer&utm_medium=panel')
  })
})

describe('update check', () => {
  test('reads a plain x.y.z version from the Open VSX answer', () => {
    assert.equal(latestOpenVsxVersion({ version: '0.2.0', namespace: 'enhancer' }), '0.2.0')
    assert.equal(latestOpenVsxVersion({ version: '0.2.0-beta' }), undefined)
    assert.equal(latestOpenVsxVersion({ error: 'not found' }), undefined)
    assert.equal(latestOpenVsxVersion(undefined), undefined)
  })

  test('VS Code asks the Visual Studio Marketplace; every other editor asks Open VSX', () => {
    assert.equal(storeFor('vscode'), 'marketplace')
    assert.equal(storeFor('vscode-insiders'), 'marketplace')
    assert.equal(storeFor('cursor'), 'openVsx')
    assert.equal(storeFor('ornus'), 'openVsx')
    assert.equal(storeFor('vscodium'), 'openVsx')
  })

  test('reads the highest plain x.y.z from the Marketplace answer, in any order', () => {
    const answer = (versions: unknown[]) => ({ results: [{ extensions: [{ versions: versions.map(version => ({ version })) }] }] })
    assert.equal(latestMarketplaceVersion(answer(['0.4.0', '0.3.1', '0.3.0'])), '0.4.0')
    assert.equal(latestMarketplaceVersion(answer(['0.3.0', '0.10.0', '0.9.2'])), '0.10.0')
    assert.equal(latestMarketplaceVersion(answer(['0.5.0-rc', '0.4.0'])), '0.4.0')
    // A pre-release carries a plain number too; only its property tells it apart.
    const preRelease = [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
    assert.equal(latestMarketplaceVersion({ results: [{ extensions: [{ versions: [
      { version: '0.5.1', properties: preRelease },
      { version: '0.4.0', properties: [{ key: 'Microsoft.VisualStudio.Code.Engine', value: '^1.90.0' }] },
    ] }] }] }), '0.4.0')
    // A malformed entry is skipped, not fatal.
    assert.equal(latestMarketplaceVersion({ results: [{ extensions: [{ versions: [null, { version: '0.4.0' }] }] }] }), '0.4.0')
    // Not listed yet: the query answers with no extension.
    assert.equal(latestMarketplaceVersion({ results: [{ extensions: [] }] }), undefined)
    assert.equal(latestMarketplaceVersion({ message: 'error' }), undefined)
    assert.equal(latestMarketplaceVersion(undefined), undefined)
  })

  test('a saved answer from another store does not count', () => {
    const fromOpenVsx = { at: 1, latest: '0.5.0', store: 'openVsx' as const }
    assert.equal(checkFrom('marketplace', fromOpenVsx), undefined)
    assert.deepEqual(checkFrom('openVsx', fromOpenVsx), fromOpenVsx)
    // Saved by a version that asked Open VSX without saying so.
    assert.equal(checkFrom('marketplace', { at: 1, latest: '0.5.0' }), undefined)
    assert.equal(checkFrom('openVsx', undefined), undefined)
  })

  test('compares versions part by part, as numbers', () => {
    assert.equal(isNewer('0.2.0', '0.1.0'), true)
    assert.equal(isNewer('0.10.0', '0.9.9'), true)
    assert.equal(isNewer('1.0.0', '0.99.99'), true)
    assert.equal(isNewer('0.1.0', '0.1.0'), false)
    assert.equal(isNewer('0.1.0', '0.1.1'), false)
  })
})

describe('panel messages', () => {
  test('known actions pass', () => {
    assert.deepEqual(parsePanelMessage({ type: 'turnOn' }), { type: 'turnOn' })
    assert.deepEqual(parsePanelMessage({ type: 'setFeature', setting: 'broom', on: false }), { type: 'setFeature', setting: 'broom', on: false })
    assert.deepEqual(parsePanelMessage({ type: 'setOption', setting: 'ornusNews', on: true }), { type: 'setOption', setting: 'ornusNews', on: true })
    assert.deepEqual(parsePanelMessage({ type: 'setInterface', setting: 'broomStartsOn', on: true }), { type: 'setInterface', setting: 'broomStartsOn', on: true })
    assert.deepEqual(parsePanelMessage({ type: 'setInterface', setting: 'broomButton', on: false }), { type: 'setInterface', setting: 'broomButton', on: false })
    assert.deepEqual(parsePanelMessage({ type: 'dismissNews', id: 'launch-1' }), { type: 'dismissNews', id: 'launch-1' })
    // The longest news id the news file allows (64) can be dismissed.
    assert.deepEqual(parsePanelMessage({ type: 'dismissNews', id: 'a'.repeat(64) }), { type: 'dismissNews', id: 'a'.repeat(64) })
  })

  test('unknown actions, other settings and wrong types are dropped', () => {
    assert.equal(parsePanelMessage({ type: 'runCommand', command: 'rm' }), undefined)
    assert.equal(parsePanelMessage({ type: 'setFeature', setting: 'http.proxy', on: true }), undefined)
    assert.equal(parsePanelMessage({ type: 'setOption', setting: 'arabic', on: true }), undefined)
    assert.equal(parsePanelMessage({ type: 'setFeature', setting: 'broom', on: 'yes' }), undefined)
    assert.equal(parsePanelMessage({ type: 'setInterface', setting: 'broom', on: true }), undefined)
    assert.equal(parsePanelMessage({ type: 'setInterface', setting: 'broomButton', on: 1 }), undefined)
    assert.equal(parsePanelMessage({ type: 'dismissNews', id: 'x'.repeat(65) }), undefined)
    assert.equal(parsePanelMessage(null), undefined)
    assert.equal(parsePanelMessage('turnOn'), undefined)
  })
})

describe('turned on', () => {
  test('a new user is off until they press Turn on', () => {
    assert.equal(turnedOnFrom(undefined, 'pristine'), false)
    assert.equal(turnedOnFrom(undefined, undefined), false)
    assert.equal(turnedOnFrom(true, 'pristine'), true)
  })

  test('a user of an earlier version whose Claude Code Enhancer already changed stays on', () => {
    assert.equal(turnedOnFrom(undefined, 'enhanced'), true)
  })

  test('another tool’s changes do not count as turned on', () => {
    assert.equal(turnedOnFrom(undefined, 'modified-elsewhere'), false)
  })
})
