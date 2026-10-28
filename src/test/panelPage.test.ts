// The control panel's webview page, run in headless Chrome and driven like a person:
// it draws the state it is sent and posts the user's clicks back to the extension.
import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { describe, test } from 'node:test'

import type { Status } from '../engine/engine.ts'
import type { LanguageId } from '../i18n/index.ts'
import { panelMeta, panelState } from '../panel/state.ts'
import type { PanelInput } from '../panel/state.ts'
import { CHROME, runInChrome } from './chrome.ts'

// Tests run from the project folder (npm test, and runners that load the .ts files as ES modules, where __dirname is absent).
const MEDIA = path.join(process.cwd(), 'media')
const CSS = fs.readFileSync(path.join(MEDIA, 'panel.css'), 'utf8')
const SCRIPT = fs.readFileSync(path.join(MEDIA, 'panel.js'), 'utf8')

const enhanced: Status = { version: '2.1.301', baseline: 'ok', files: 'enhanced', appliedFeatures: ['rtl', 'broom', 'quoteReply', 'quoteTools', 'imagePreview'] }
const base: PanelInput = {
  turnedOn: true,
  featureSetting: name => name === 'quoteTools' ? false : undefined,
  reapplyAfterUpdate: true,
  checkForUpdates: true,
  ornusNews: true,
  feedbackButton: true, feedbackDetails: { extension: '0.1.0', claudeCode: '2.1.301', editor: 'Visual Studio Code 1.105.0', os: 'darwin arm64' },
  feedbackAnswers: [],
  claudeCode: { status: enhanced },
  lastResult: { outcome: 'applied', changed: false, features: [
    { id: 'rtl', outcome: 'applied' }, { id: 'broom', outcome: 'applied' }, { id: 'quoteReply', outcome: 'applied' }, { id: 'imagePreview', outcome: 'applied' },
  ] },
  syncing: false,
  reloadPending: false,
  updateAvailable: undefined,
  // A news text holding markup must show as text, never become elements.
  news: { id: 'launch', title: { en: '<img src=x onerror="window.__pwned=1">Hello', ar: 'مرحبًا' }, text: { en: 'Short line', ar: 'سطر قصير' }, url: 'https://ornus.ai/' },
  justVerified: false,
  language: { setting: 'auto', everywhere: true },
}

// Captures what the page posts, and sets the editor's language before the panel script runs.
const host = (lang: LanguageId) => `
document.documentElement.lang = '${lang}'; document.documentElement.dir = '${panelMeta('0.1.0', lang).dir}';
window.__sent = [];
window.acquireVsCodeApi = function () { return { postMessage: function (m) { window.__sent.push(m); } }; };`

function run (lang: LanguageId, states: unknown[], steps: string) {
  return runInChrome({
    css: CSS,
    scripts: [host(lang), SCRIPT],
    body: '<div id="app"></div>',
    driver: `
      const send = s => window.postMessage({ type: 'state', state: s, meta: ${JSON.stringify(panelMeta('0.1.0', lang))} }, '*');
      const states = ${JSON.stringify(states)};
      const q = sel => document.querySelector(sel);
      const click = sel => q(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const wait = () => new Promise(r => setTimeout(r, 30));
      (async () => {
        const out = {};
        send(states[0]); await wait();
        ${steps}
        out.sent = window.__sent;
        document.body.setAttribute('data-result', JSON.stringify(out));
      })();`,
  })
}

describe('control panel page', { skip: CHROME ? false : 'Chrome not found' }, () => {
  test('main panel: switches match the settings, a click posts the change, news stays text', () => {
    const result = run('en', [panelState(base)], `
      out.status = q('#status-line').textContent;
      out.switches = [...document.querySelectorAll('#section-enhancements [role=switch]')].map(s => s.getAttribute('aria-checked'));
      out.badges = [...document.querySelectorAll('#section-enhancements .row')].map(r => r.querySelector('.badge')?.textContent ?? null);
      out.newsTitle = q('#news-slot b').textContent;
      out.newsImages = document.querySelectorAll('#news-slot img').length;
      out.pwned = window.__pwned === 1;
      out.mascot = q('#main-head svg.mascot') && q('#main-head svg.mascot').dataset.mascot;
      out.locked = [...document.querySelectorAll('#section-ornus .row.locked .t')].map(e => e.textContent);
      out.lockedValues = [...document.querySelectorAll('#section-ornus .row.locked .v')].map(e => e.textContent);
      out.downloadButton = q('#row-download-ornus .btn').textContent;
      click('#row-broom [role=switch]'); await wait();
      out.broomAfterClick = q('#row-broom [role=switch]').getAttribute('aria-checked');
      click('#row-quoteTools [role=switch]');
      click('#news-slot .x');
      click('#row-restore');
      click('#row-download-ornus .btn');
      click('#row-news-toggle [role=switch]');
    `)
    assert.equal(result.status, 'Active on Claude Code 2.1.301')
    assert.deepEqual(result.switches, ['true', 'true', 'true', 'false', 'true'])
    assert.deepEqual(result.badges, ['Active', 'Active', 'Active', null, 'Active'])
    assert.equal(result.newsTitle, '<img src=x onerror="window.__pwned=1">Hello')
    assert.equal(result.newsImages, 0)
    assert.equal(result.pwned, false)
    assert.equal(result.mascot, 'still')
    assert.deepEqual(result.locked, ['Notification and sound when Claude finishes', 'Arabic voice input', 'Review changes across files'])
    // Ornus is released with notifications and Arabic voice; the multi-file review has not shipped yet (PLAN §7 Launch).
    assert.deepEqual(result.lockedValues, ['Available in Ornus', 'Available in Ornus', 'Coming to Ornus'])
    assert.equal(result.downloadButton, 'Download Ornus')
    assert.equal(result.broomAfterClick, 'false')
    assert.deepEqual(result.sent, [
      { type: 'ready' },
      { type: 'setFeature', setting: 'broom', on: false },
      { type: 'setFeature', setting: 'quoteTools', on: true },
      { type: 'dismissNews', id: 'launch' },
      { type: 'restore' },
      { type: 'downloadOrnus' },
      { type: 'setOption', setting: 'ornusNews', on: false },
    ])
  })

  test('Interface section: the broom choices show their settings, a click posts the change; greyed while the broom is off', () => {
    const chosen = { broomStartsOn: true } as Record<string, boolean>
    const result = run('ar', [panelState({ ...base, featureSetting: name => chosen[name] }), panelState({ ...base, featureSetting: name => name === 'broom' ? false : undefined })], `
      out.title = q('#section-interface .section-t').textContent;
      out.rows = [...document.querySelectorAll('#row-broom-starts-on, #row-broom-button')].map(r => [r.querySelector('.t').textContent, r.querySelector('[role=switch]').getAttribute('aria-checked')]);
      click('#row-broom-starts-on [role=switch]');
      click('#row-broom-button [role=switch]');
      send(states[1]); await wait();
      out.greyed = [...document.querySelectorAll('#row-broom-starts-on [role=switch], #row-broom-button [role=switch]')].map(s => s.disabled);
      click('#row-broom-button [role=switch]');
    `)
    assert.equal(result.title, 'الواجهة')
    assert.deepEqual(result.rows, [['المكنسة مشغّلة افتراضيًا', 'true'], ['إظهار أيقونة المكنسة', 'true']])
    assert.deepEqual(result.greyed, [true, true])
    assert.deepEqual(result.sent, [
      { type: 'ready' },
      { type: 'setInterface', setting: 'broomStartsOn', on: false },
      { type: 'setInterface', setting: 'broomButton', on: false },
    ])
  })

  test('welcome in Arabic: right to left, the welcome mascot, Turn on posts once', () => {
    const result = run('ar', [panelState({ ...base, turnedOn: false })], `
      out.dir = document.documentElement.dir;
      out.title = q('#welcome h2').textContent;
      out.mascot = q('#welcome svg').dataset.mascot;
      click('#welcome .btn.primary');
    `)
    assert.equal(result.dir, 'rtl')
    assert.equal(result.title, 'محادثة Claude Code أهدأ وتقرأ لغات اليمين لليسار')
    assert.equal(result.mascot, 'welcome')
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'turnOn' }])
  })

  test('applying: greyed switches ignore clicks; then the reload banner offers Later and Reload', () => {
    const result = run('en', [panelState({ ...base, syncing: true }), panelState({ ...base, reloadPending: true })], `
      out.applying = q('#status-line').textContent;
      out.disabled = [...document.querySelectorAll('#section-enhancements [role=switch]')].every(s => s.disabled);
      out.mascot = q('#main-head svg.mascot').dataset.mascot;
      click('#row-rtl [role=switch]');
      send(states[1]); await wait();
      out.banner = q('#reload-banner .t').textContent;
      click('#reload-banner .btn.primary');
      click('#reload-banner .btn:not(.primary)');
    `)
    assert.equal(result.applying, 'Applying enhancements…')
    assert.equal(result.disabled, true)
    assert.equal(result.mascot, 'applying')
    assert.equal(result.banner, 'Ready. Reload the editor to see it.')
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'reload' }, { type: 'later' }])
  })

  test('a feature that did not fit: no mascot, the row says it waits for an update and opens its details', () => {
    const failed = panelState({ ...base, featureSetting: () => undefined, lastResult: { outcome: 'applied', changed: false, features: [
      { id: 'rtl', outcome: 'applied' }, { id: 'broom', outcome: 'failed', reason: 'anchor' }, { id: 'quoteReply', outcome: 'applied' }, { id: 'quoteTools', outcome: 'applied' }, { id: 'imagePreview', outcome: 'applied' },
    ] } })
    const result = run('ar', [failed], `
      out.status = q('#status-line').textContent;
      out.mascot = !!q('#main-head svg.mascot');
      out.row = q('#row-broom .badge.wait').textContent;
      out.others = ['rtl', 'quoteReply', 'quoteTools', 'imagePreview'].map(id => q('#row-' + id + ' .badge.ok').textContent);
      out.news = !!q('#news-slot');
      click('#row-broom');
    `)
    assert.equal(result.status, '4 من 5 تحسينات تعمل')
    assert.equal(result.mascot, false)
    assert.equal(result.row, 'بانتظار تحديث الإضافة')
    assert.deepEqual(result.others, ['يعمل', 'يعمل', 'يعمل', 'يعمل'])
    assert.equal(result.news, false)
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'featureProblem', id: 'broom' }])
  })

  test('a new Claude Code version where nothing fit: no notice, every row waits for an update; privacy (i) opens its note', () => {
    const nothingFit = panelState({
      ...base,
      featureSetting: () => undefined,
      claudeCode: { status: { ...enhanced, version: '2.1.310', files: 'pristine', appliedFeatures: [] } },
      lastResult: { outcome: 'applied', changed: false, features: [
        { id: 'rtl', outcome: 'failed', reason: 'a' }, { id: 'broom', outcome: 'failed', reason: 'b' },
        { id: 'quoteReply', outcome: 'failed', reason: 'c' }, { id: 'quoteTools', outcome: 'failed', reason: 'd' }, { id: 'imagePreview', outcome: 'failed', reason: 'e' },
      ] },
    })
    const result = run('en', [nothingFit], `
      out.status = q('#status-line').textContent;
      out.notice = !!q('#notice');
      out.rows = [...document.querySelectorAll('#section-enhancements .badge.wait')].map(e => e.textContent);
      out.noteBefore = !!q('#privacy-note');
      click('#section-privacy .info'); await wait();
      out.noteAfter = !!q('#privacy-note');
    `)
    assert.equal(result.status, '0 of 5 enhancements active')
    assert.equal(result.notice, false)
    assert.deepEqual(result.rows, ['Waiting for an update', 'Waiting for an update', 'Waiting for an update', 'Waiting for an update', 'Waiting for an update'])
    assert.equal(result.noteBefore, false)
    assert.equal(result.noteAfter, true)
  })

  test('an available update shows a banner whose button asks for the update', () => {
    const result = run('en', [panelState({ ...base, updateAvailable: '0.2.0' })], `
      out.text = q('#update-banner .t').textContent;
      click('#update-banner .btn');
    `)
    assert.equal(result.text, 'Enhancer 0.2.0 is available.')
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'update' }])
  })

  test('not restored: the notice offers Try again, which asks for another sync', () => {
    const result = run('ar', [panelState({ ...base, featureSetting: () => false, lastResult: undefined })], `
      out.title = q('#notice b').textContent;
      click('#notice .btn');
    `)
    assert.equal(result.title, 'Claude Code ما زال يحمل التحسينات')
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'applyNow' }])
  })
})
