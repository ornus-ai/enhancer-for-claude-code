// Renders the README pictures from art.html into assets/readme/ as 2x PNGs, one per theme
// (light, dark) and, for [data-per-lang] pictures, per language (en, ar):
//   node scripts/readme-art/render.mjs
// Chrome is started only through the shared helper, so it never outlives this script.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { openHeadlessChrome } = await import(`${process.env.HOME}/.claude/lib/headless-chrome.mjs`)

const here = dirname(fileURLToPath(import.meta.url))
const page = pathToFileURL(join(here, 'art.html')).href
const out = resolve(here, '../../assets/readme')
mkdirSync(out, { recursive: true })

/** A minimal DevTools protocol client over one flattened session. */
function connect (wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const waiters = []
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? fail(new Error(`${msg.error.message}`)) : ok(msg.result)
    } else if (msg.method) {
      for (const w of waiters.filter(w => w.method === msg.method)) { waiters.splice(waiters.indexOf(w), 1); w.ok(msg.params) }
    }
  }
  const opened = new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    pending.set(++id, { ok, fail })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const once = method => new Promise(ok => waiters.push({ method, ok }))
  return { opened, send, once, close: () => ws.close() }
}

const chrome = await openHeadlessChrome({ windowSize: '1000,1400' })
try {
  const cdp = connect(chrome.browserWsUrl)
  await cdp.opened
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const s = (method, params) => cdp.send(method, params, sessionId)
  await s('Page.enable')
  await s('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1400, deviceScaleFactor: 2, mobile: false })
  await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })

  const written = []
  for (const theme of ['light', 'dark']) {
    for (const lang of ['en', 'ar']) {
      const loaded = cdp.once('Page.loadEventFired')
      await s('Page.navigate', { url: `${page}?theme=${theme}&lang=${lang}` })
      await loaded
      const { result } = await s('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `document.fonts.ready.then(() => [...document.querySelectorAll('[data-art]')].map(el => {
          const r = el.getBoundingClientRect()
          return { name: el.dataset.art, perLang: el.hasAttribute('data-per-lang'), x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }
        }))`,
      })
      for (const art of result.value) {
        if (!art.perLang && lang !== 'en') continue
        const { data } = await s('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
          clip: { x: art.x, y: art.y, width: art.width, height: art.height, scale: 1 },
        })
        const file = `${art.name}${art.perLang ? `-${lang}` : ''}-${theme}.png`
        writeFileSync(join(out, file), Buffer.from(data, 'base64'))
        written.push(file)
      }
    }
  }
  cdp.close()
  console.log(`${written.length} pictures in assets/readme:\n${written.sort().join('\n')}`)
} finally {
  await chrome.close()
}
