// Feedback: the extension's side (what it posts, how it reads the answer) and the worker on
// ornus.ai that forwards a message to the owner's Telegram chat. The extension's request
// must pass the worker's own check: the two sides share one contract (FeedbackRequest v1).
import * as assert from 'assert/strict'
import { describe, test } from 'node:test'

import { BODY_MAX_BYTES, DAILY_LIMIT, REPEAT_WINDOW_S, handleFeedback, senderKey, validFeedback } from '../feedbackWorker/worker.ts'
import type { Memory } from '../feedbackWorker/worker.ts'
import type { FeedbackEnv } from '../feedbackWorker/worker.ts'
import { FEEDBACK_URL, feedbackRequest, featuresSummary, isSendable, postFeedback } from '../panel/feedback.ts'
import type { FeedbackDetails, FeedbackDraft } from '../panel/feedback.ts'
import { parsePanelMessage } from '../panel/messages.ts'

const details: FeedbackDetails = { extension: '0.1.0', claudeCode: '2.1.302', editor: 'Visual Studio Code 1.105.0', os: 'darwin arm64', features: 'rtl on, broom on' }
const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({ kind: 'suggestion', text: 'Add a dark mascot', email: '', attach: true, ...over })

type Call = { url: string; body: Record<string, unknown> }
function telegram (status = 200) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return new Response('{}', { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const allow = { limit: async () => ({ success: true }) }
const deny = { limit: async () => ({ success: false }) }
const env = (over: Partial<FeedbackEnv> = {}): FeedbackEnv =>
  ({ TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '42', PER_SENDER: allow, ALL_SENDERS: allow, ...over })

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://ornus.ai/enhancer/feedback', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

describe('feedback worker', () => {
  test('a valid message reaches the Telegram chat once, as plain text with the details', async () => {
    const { calls, fetchImpl } = telegram()
    const request = feedbackRequest(draft({ kind: 'problem', text: 'The broom hides <b>everything</b>', email: 'a@b.co' }), details, 'ar')
    const response = await handleFeedback(post(request), env(), fetchImpl)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.telegram.org/botbot-token/sendMessage')
    assert.equal(calls[0].body.chat_id, '42')
    assert.equal(calls[0].body.parse_mode, undefined, 'no markup mode: what the user wrote stays text')
    assert.equal(calls[0].body.text, [
      '🐞 Enhancer — مشكلة', '', 'The broom hides <b>everything</b>', '',
      'Language: ar', 'Reply to: a@b.co',
      'Enhancer 0.1.0 · Claude Code 2.1.302', 'Visual Studio Code 1.105.0 · darwin arm64', 'Enhancements: rtl on, broom on',
    ].join('\n'))
  })

  test('a suggestion without email or details sends only the text: the language goes with the details', async () => {
    const { calls, fetchImpl } = telegram()
    await handleFeedback(post(feedbackRequest(draft({ attach: false }), details, 'en')), env(), fetchImpl)
    assert.equal(calls[0].body.text, '💡 Enhancer — اقتراح\n\nAdd a dark mascot')
  })

  test('a body sent in pieces without a declared size is dropped once it passes 8 KB; a small one goes through', async () => {
    const streamed = (size: number) => new Request('https://ornus.ai/enhancer/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: new ReadableStream({
        start (controller) {
          const json = JSON.stringify({ v: 1, kind: 'suggestion', text: 'x'.repeat(size), lang: 'en' })
          const bytes = new TextEncoder().encode(json)
          for (let at = 0; at < bytes.length; at += 1024) controller.enqueue(bytes.slice(at, at + 1024))
          controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit)
    const { calls, fetchImpl } = telegram()
    const big = streamed(20_000)
    assert.equal(big.headers.get('content-length'), null)
    assert.equal((await handleFeedback(big, env(), fetchImpl)).status, 413)
    assert.equal(calls.length, 0)
    assert.equal((await handleFeedback(streamed(500), env(), fetchImpl)).status, 200)
    const nonsense = await handleFeedback(post({ v: 1, kind: 'suggestion', text: 'hi', lang: 'en' }, { 'content-length': 'lots' }), env(), fetchImpl)
    assert.equal(nonsense.status, 413)
  })

  test('IPv6 senders are counted by their /64 block, IPv4 senders by their address', async () => {
    assert.equal(senderKey('203.0.113.7'), '203.0.113.7')
    assert.equal(senderKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64')
    assert.equal(senderKey('2001:DB8:1:2::1'), '2001:db8:1:2::/64')
    assert.equal(senderKey('2001:db8::1'), '2001:db8:0:0::/64')
    assert.equal(senderKey('::1'), '0:0:0:0::/64')
    // An IPv4 address written as IPv6 counts as itself, not as one shared block.
    assert.equal(senderKey('::ffff:203.0.113.7'), '203.0.113.7')
    assert.equal(senderKey('::FFFF:198.51.100.1'), '198.51.100.1')
    const keys: string[] = []
    const counting = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true } } }
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2:ffff::9'])
      await handleFeedback(post(feedbackRequest(draft(), details, 'en'), { 'cf-connecting-ip': ip }), env({ PER_SENDER: counting }), telegram().fetchImpl)
    assert.deepEqual(keys, ['2001:db8:1:2::/64', '2001:db8:1:2::/64'])
  })

  test('a broken body is refused and nothing reaches the chat', async () => {
    const good = { v: 1, kind: 'suggestion', text: 'Hi', lang: 'en' }
    const bad: unknown[] = [
      { ...good, v: 2 }, { ...good, kind: 'praise' }, { ...good, text: '   ' }, { ...good, text: 'x'.repeat(2001) },
      { ...good, text: 'bell\u0007' }, { ...good, lang: 'english' }, { ...good, email: 'not-an-email' },
      { ...good, details: { ...details, features: 'x'.repeat(301) } }, { ...good, details: { extension: '1' } },
      [good], 'not json',
    ]
    for (const body of bad) {
      const { calls, fetchImpl } = telegram()
      const response = await handleFeedback(post(body), env(), fetchImpl)
      assert.equal(response.status, 400, JSON.stringify(body))
      assert.equal(calls.length, 0)
    }
  })

  test('only a JSON POST is taken: other methods, other content types and oversized bodies are refused', async () => {
    const { calls, fetchImpl } = telegram()
    const get = await handleFeedback(new Request('https://ornus.ai/enhancer/feedback'), env(), fetchImpl)
    assert.equal(get.status, 405)
    // A plain form post is what a web page could send without asking the browser first.
    const form = await handleFeedback(post('text=hi', { 'content-type': 'text/plain' }), env(), fetchImpl)
    assert.equal(form.status, 415)
    const big = await handleFeedback(post({ v: 1, kind: 'suggestion', text: 'x'.repeat(BODY_MAX_BYTES), lang: 'en' }), env(), fetchImpl)
    assert.equal(big.status, 413)
    assert.equal(calls.length, 0)
  })

  test('a sender over the limit, or everyone over the shared limit, gets 429 and nothing is sent', async () => {
    const body = feedbackRequest(draft(), details, 'en')
    for (const limits of [{ PER_SENDER: deny }, { ALL_SENDERS: deny }]) {
      const { calls, fetchImpl } = telegram()
      const response = await handleFeedback(post(body), env(limits), fetchImpl)
      assert.equal(response.status, 429)
      assert.equal(calls.length, 0)
    }
  })

  test('the sender address is what the per-sender limit counts', async () => {
    const keys: string[] = []
    const counting = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: true } } }
    await handleFeedback(post(feedbackRequest(draft(), details, 'en')), env({ PER_SENDER: counting }), telegram().fetchImpl)
    assert.deepEqual(keys, ['203.0.113.7'])
  })

  test('Telegram refusing or unreachable answers 502; missing secrets answer 503', async () => {
    const body = feedbackRequest(draft(), details, 'en')
    assert.equal((await handleFeedback(post(body), env(), telegram(401).fetchImpl)).status, 502)
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    assert.equal((await handleFeedback(post(body), env(), down)).status, 502)
    assert.equal((await handleFeedback(post(body), env({ TELEGRAM_BOT_TOKEN: undefined }), telegram().fetchImpl)).status, 503)
  })
})

/** Workers KV stand-in: remembers values and the lifetime each was given. */
function memory () {
  const values = new Map<string, string>()
  const ttls = new Map<string, number | undefined>()
  const store: Memory = {
    get: async key => values.get(key) ?? null,
    put: async (key, value, options) => { values.set(key, value); ttls.set(key, options?.expirationTtl) },
  }
  return { store, values, ttls }
}

describe('feedback worker: repeats and the daily cap', () => {
  const ask = (text: string, ip = '203.0.113.7') =>
    post(feedbackRequest(draft({ text }), details, 'en'), { 'cf-connecting-ip': ip })
  const day1 = new Date('2026-10-18T10:00:00Z')

  test('the same message again within the hour is answered ok but not delivered; spacing and case do not hide it', async () => {
    const { store, ttls } = memory()
    const { calls, fetchImpl } = telegram()
    const first = await handleFeedback(ask('Please add a dark theme'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    const again = await handleFeedback(ask('  please ADD a   dark theme '), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    const other = await handleFeedback(ask('Please add a light theme'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    assert.deepEqual([first.status, again.status, other.status], [200, 200, 200])
    assert.deepEqual(await again.json(), { ok: true })
    assert.equal(calls.length, 2)
    assert.deepEqual([...ttls.entries()].filter(([k]) => k.startsWith('repeat:')).map(([, t]) => t), [3600, 3600])
    assert.equal(REPEAT_WINDOW_S, 3600)
  })

  test('a message whose delivery failed is not taken for a repeat when the user tries again', async () => {
    const { store } = memory()
    await handleFeedback(ask('Retry me'), env({ FEEDBACK_MEMORY: store }), telegram(500).fetchImpl, day1)
    const { calls, fetchImpl } = telegram()
    const retry = await handleFeedback(ask('Retry me'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    assert.equal(retry.status, 200)
    assert.equal(calls.length, 1)
  })

  test('a sender gets ten messages a day; the eleventh is refused as daily, others and the next day are not', async () => {
    const { store } = memory()
    const { calls, fetchImpl } = telegram()
    const statuses: number[] = []
    // Spread over the same UTC day: the count is per day, not per moment.
    for (let i = 1; i <= 11; i++) {
      const at = new Date(Date.UTC(2026, 9, 18, i * 2, i))
      statuses.push((await handleFeedback(ask(`idea ${i}`), env({ FEEDBACK_MEMORY: store }), fetchImpl, at)).status)
    }
    assert.equal(DAILY_LIMIT, 10)
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429])
    const refused = await handleFeedback(ask('idea 12'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    assert.deepEqual(await refused.json(), { ok: false, error: 'daily' })
    assert.equal(calls.length, 10)
    assert.equal((await handleFeedback(ask('idea 13', '198.51.100.9'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)).status, 200)
    const nextDay = new Date('2026-10-19T00:00:01Z')
    assert.equal((await handleFeedback(ask('idea 14'), env({ FEEDBACK_MEMORY: store }), fetchImpl, nextDay)).status, 200)
    assert.equal(calls.length, 12)
  })

  test('a send that fails to reach Telegram uses up no part of the day', async () => {
    const { store, values } = memory()
    values.set('day:2026-10-18:203.0.113.7', '9')
    const failed = await handleFeedback(ask('the tenth'), env({ FEEDBACK_MEMORY: store }), telegram(502).fetchImpl, day1)
    assert.equal(failed.status, 502)
    const { calls, fetchImpl } = telegram()
    assert.equal((await handleFeedback(ask('the tenth'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)).status, 200)
    assert.equal((await handleFeedback(ask('one more'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)).status, 429)
    assert.equal(calls.length, 1)
  })

  test('a repeat does not use up the day', async () => {
    const { store } = memory()
    const { fetchImpl } = telegram()
    for (let i = 0; i < 15; i++) await handleFeedback(ask('same words'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)
    assert.equal((await handleFeedback(ask('new words'), env({ FEEDBACK_MEMORY: store }), fetchImpl, day1)).status, 200)
  })

  test('if the memory fails, feedback is still delivered', async () => {
    const broken: Memory = { get: async () => { throw new Error('kv down') }, put: async () => { throw new Error('quota') } }
    const { calls, fetchImpl } = telegram()
    const response = await handleFeedback(ask('Still here'), env({ FEEDBACK_MEMORY: broken }), fetchImpl, day1)
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
  })
})

describe('feedback from the extension', () => {
  test('the details and the language go only when the box is ticked; an empty email is left out', () => {
    assert.deepEqual(feedbackRequest(draft({ attach: false, email: '  ' }), details, 'fr'), { v: 1, kind: 'suggestion', text: 'Add a dark mascot' })
    assert.equal(feedbackRequest(draft(), details, 'fr').lang, 'fr')
    assert.deepEqual(feedbackRequest(draft({ email: ' a@b.co ' }), details, 'fr').details, details)
    assert.equal(feedbackRequest(draft({ email: ' a@b.co ' }), details, 'fr').email, 'a@b.co')
  })

  test('what the extension sends always passes the worker check, even with a long failure reason or pasted control characters', () => {
    const long = { ...details, features: 'broom waiting (' + 'anchor '.repeat(80) + ')' }
    const request = feedbackRequest(draft({ text: '  line one\nline\ttwo\u0007  ' }), long, 'zh-cn')
    const valid = validFeedback(JSON.parse(JSON.stringify(request)))
    assert.ok(valid)
    assert.equal(valid.text, 'line one\nline\ttwo')
    assert.equal(valid.details?.features.length, 300)
  })

  test('a draft is sendable with text and an empty or address-like email', () => {
    assert.equal(isSendable(draft()), true)
    assert.equal(isSendable(draft({ text: '  ' })), false)
    assert.equal(isSendable(draft({ text: 'x'.repeat(2001) })), false)
    assert.equal(isSendable(draft({ email: 'a@b.co' })), true)
    assert.equal(isSendable(draft({ email: 'a@b' })), false)
    // Only invisible characters: nothing would be left to send.
    assert.equal(isSendable(draft({ text: '\u0007\u0008 ' })), false)
  })

  test('the answer reads as sent, rate limited, refused, unavailable (server) or failed (no answer); a network error never throws', async () => {
    const answer = (status: number) => (async (url: string) => {
      assert.equal(url, FEEDBACK_URL)
      return new Response('{}', { status })
    }) as unknown as typeof fetch
    const request = feedbackRequest(draft(), details, 'en')
    assert.equal(await postFeedback(request, answer(200)), 'sent')
    assert.equal(await postFeedback(request, answer(429)), 'rate')
    const daily = (async () => new Response('{"ok":false,"error":"daily"}', { status: 429 })) as unknown as typeof fetch
    assert.equal(await postFeedback(request, daily), 'daily')
    assert.equal(await postFeedback(request, answer(400)), 'invalid')
    assert.equal(await postFeedback(request, answer(503)), 'unavailable')
    assert.equal(await postFeedback(request, answer(502)), 'unavailable')
    assert.equal(await postFeedback(request, (async () => { throw new Error('offline') }) as unknown as typeof fetch), 'failed')
  })

  test('the enhancements line says how each one stands', () => {
    assert.equal(featuresSummary([
      { id: 'rtl', on: true, active: true }, { id: 'broom', on: true, problem: 'failed', reason: 'anchor' },
      { id: 'quoteReply', on: false }, { id: 'imagePreview', on: true },
    ]), 'rtl on, broom waiting (anchor), quoteReply off, imagePreview on, not yet applied')
  })

  test('the panel may post a feedback draft; a wrong kind or types are dropped', () => {
    assert.deepEqual(parsePanelMessage({ type: 'sendFeedback', id: 'ab12', kind: 'problem', text: 'x', email: '', attach: false }),
      { type: 'sendFeedback', id: 'ab12', kind: 'problem', text: 'x', email: '', attach: false })
    assert.equal(parsePanelMessage({ type: 'sendFeedback', kind: 'problem', text: 'x', email: '', attach: false }), undefined)
    assert.equal(parsePanelMessage({ type: 'sendFeedback', id: 'A B', kind: 'problem', text: 'x', email: '', attach: false }), undefined)
    assert.equal(parsePanelMessage({ type: 'sendFeedback', kind: 'spam', text: 'x', email: '', attach: false }), undefined)
    assert.equal(parsePanelMessage({ type: 'sendFeedback', kind: 'problem', text: 'x', email: '', attach: 'yes' }), undefined)
    assert.equal(parsePanelMessage({ type: 'sendFeedback', kind: 'problem', text: 5, email: '', attach: true }), undefined)
    assert.deepEqual(parsePanelMessage({ type: 'setOption', setting: 'feedbackButton', on: false }), { type: 'setOption', setting: 'feedbackButton', on: false })
  })
})
