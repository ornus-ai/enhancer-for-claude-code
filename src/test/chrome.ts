// Runs a page in headless Chrome and returns what its driver script recorded in
// body[data-result]. Shared by the behaviour tests of the injected scripts.
import * as assert from 'assert/strict'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { makeTempDir } from './tmp.ts'

export const CHROME = process.env.ENHANCER_CHROME
  ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    .find(p => fs.existsSync(p))

// Stand-ins for what headless Chrome lacks, set before the scripts under test run:
// --dump-dom draws a single frame, so requestAnimationFrame fires once only (a timer stands
// in for the display's frames); a file page has no clipboard permission, so writeText
// records what it was given.
const ENVIRONMENT = `
window.requestAnimationFrame = function (cb) { return setTimeout(function () { cb(performance.now()); }, 16); };
window.__copied = null;
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } } });`

export function runInChrome (page: { css: string; scripts: string[]; body: string; driver: string }) {
  const dir = makeTempDir('enhancer-chrome-')
  const file = path.join(dir, 'chat.html')
  const scripts = [ENVIRONMENT, ...page.scripts, page.driver].map(s => `<script>${s}</script>`).join('\n')
  fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${page.css}</style></head>
<body>${page.body}${scripts}</body></html>`)
  // --no-sandbox: test runners that sandbox their children stop Chrome's own sandbox from
  // starting; the page is a local file this test wrote.
  // --dump-dom makes Chrome quit by itself once the page is drawn; a hung Chrome is
  // killed outright at the timeout (a stuck Chrome may ignore the default SIGTERM, and
  // killing its main process ends its helper processes too).
  const dom = execFileSync(CHROME!, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`,
    '--virtual-time-budget=10000', '--dump-dom', `file://${file}`,
  ], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' })
  const match = dom.match(/data-result="([^"]*)"/)
  assert.ok(match, 'the page did not finish its steps')
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
}
