// The "Send feedback" dialog of the control panel, run in headless Chrome and driven like a
// person: open it, write, send, read the answer.
import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { describe, test } from 'node:test'

import type { LanguageId } from '../i18n/index.ts'
import { panelMeta, panelState } from '../panel/state.ts'
import type { PanelInput } from '../panel/state.ts'
import { CHROME, runInChrome } from './chrome.ts'

const MEDIA = path.join(process.cwd(), 'media')
const CSS = fs.readFileSync(path.join(MEDIA, 'panel.css'), 'utf8')
const SCRIPT = fs.readFileSync(path.join(MEDIA, 'panel.js'), 'utf8')

const input = (over: Partial<PanelInput> = {}): PanelInput => ({
  turnedOn: true,
  featureSetting: () => undefined,
  reapplyAfterUpdate: true,
  checkForUpdates: true,
  ornusNews: true,
  feedbackButton: true,
  feedbackDetails: { extension: '0.1.0', claudeCode: '2.1.302', editor: 'Visual Studio Code 1.105.0', os: 'darwin arm64' },
  feedbackAnswers: [],
  claudeCode: { status: { version: '2.1.302', baseline: 'ok', files: 'enhanced', appliedFeatures: ['rtl', 'broom', 'quoteReply', 'quoteTools', 'imagePreview'] } },
  lastResult: undefined,
  syncing: false,
  reloadPending: false,
  updateAvailable: undefined,
  news: undefined,
  justVerified: false,
  language: { setting: 'auto', everywhere: true },
  ...over,
})

// `saved`: the webview state the editor kept from an earlier page of this tab (a hidden tab drops its page).
function run (lang: LanguageId, state: unknown, steps: string, saved?: unknown) {
  return runInChrome({
    css: CSS,
    scripts: [`
document.documentElement.lang = '${lang}'; document.documentElement.dir = '${panelMeta('0.1.0', lang).dir}';
window.__sent = [];
window.__saved = ${JSON.stringify(saved ?? null)};
window.acquireVsCodeApi = function () { return {
  postMessage: function (m) { window.__sent.push(m); },
  getState: function () { return window.__saved; },
  setState: function (v) { window.__saved = JSON.parse(JSON.stringify(v)); },
}; };`, SCRIPT],
    body: '<div id="app"></div>',
    driver: `
      const send = s => window.postMessage({ type: 'state', state: s, meta: ${JSON.stringify(panelMeta('0.1.0', lang))} }, '*');
      const base = ${JSON.stringify(state)};
      // The extension answers a send through the next panel state, by the id the page gave it.
      const answer = result => {
        const id = window.__sent.filter(m => m.type === 'sendFeedback').at(-1).id;
        send({ ...base, feedback: { ...base.feedback, answers: [{ id, result }] } });
      };
      const q = sel => document.querySelector(sel);
      const click = sel => q(sel).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const type = (sel, text) => { const el = q(sel); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); };
      const wait = () => new Promise(r => setTimeout(r, 30));
      (async () => {
        const out = {};
        send(base); await wait();
        ${steps}
        out.ids = window.__sent.filter(m => m.type === 'sendFeedback').map(m => /^[a-z0-9]{1,32}$/.test(m.id));
        out.sent = window.__sent.filter(m => m.type !== 'ready').map(({ id, ...m }) => m);
        out.saved = window.__saved;
        document.body.setAttribute('data-result', JSON.stringify(out));
      })();`,
  })
}

describe('feedback dialog', { skip: CHROME ? false : 'Chrome not found' }, () => {
  test('write a problem, keep it through a panel redraw, see what is sent, send it, and get thanked', () => {
    const state = panelState(input())
    const result = run('en', state, `
      out.row = q('#row-feedback').textContent;
      click('#row-feedback'); await wait();
      out.open = q('#feedback-dialog').open;
      out.focused = document.activeElement.id;
      out.sendDisabledEmpty = q('#fb-send').disabled;
      click('[data-kind="problem"]'); await wait();
      out.placeholder = q('#fb-text').placeholder;
      type('#fb-text', 'The broom hides my answer');
      send(base); await wait();
      out.keptAfterRedraw = q('#fb-text').value;
      out.details = q('#fb-details').textContent;
      click('#fb-send'); await wait();
      out.sendingLabel = q('#fb-send').textContent;
      out.sendingDisabled = q('#fb-send').disabled;
      answer('sent'); await wait();
      out.thanks = q('#fb-title').textContent;
      click('[data-fb="close"]'); await wait();
      out.closed = !q('#feedback-dialog').open;
      click('#row-feedback'); await wait();
      out.emptyAfterSent = q('#fb-text').value;
    `)
    assert.equal(result.row, 'Send feedback')
    assert.equal(result.open, true)
    assert.equal(result.focused, 'fb-text')
    assert.equal(result.sendDisabledEmpty, true)
    assert.equal(result.placeholder, 'What happened, and what did you expect?')
    assert.equal(result.keptAfterRedraw, 'The broom hides my answer')
    assert.equal(result.details, 'Enhancer 0.1.0\nClaude Code 2.1.302\nVisual Studio Code 1.105.0\ndarwin arm64\nLanguage: en\nEnhancements: rtl on, broom on, quoteReply on, quoteTools on, imagePreview on')
    assert.equal(result.sendingLabel, 'Sending…')
    assert.equal(result.sendingDisabled, true)
    assert.equal(result.thanks, 'Thank you. Your message reached us.')
    assert.equal(result.closed, true)
    assert.equal(result.emptyAfterSent, '')
    assert.deepEqual(result.sent, [{ type: 'sendFeedback', kind: 'problem', text: 'The broom hides my answer', email: '', attach: true }])
    assert.deepEqual(result.ids, [true])
  })

  test('a failed send keeps the text and says so; a wrong email is caught before sending; unticking the details is posted', () => {
    const result = run('ar', panelState(input()), `
      click('#row-feedback'); await wait();
      type('#fb-text', 'اقتراح: زر للنسخ');
      type('#fb-email', 'not-an-email');
      click('#fb-send'); await wait();
      out.emailError = q('#fb-error').textContent;
      out.sentAfterBadEmail = window.__sent.filter(m => m.type === 'sendFeedback').length;
      type('#fb-email', 'me@example.com');
      q('#fb-attach').checked = false; q('#fb-attach').dispatchEvent(new Event('input', { bubbles: true }));
      click('#fb-send'); await wait();
      answer('failed'); await wait();
      out.failError = q('#fb-error').textContent;
      out.kept = q('#fb-text').value;
      out.sendEnabled = !q('#fb-send').disabled;
      click('#fb-send'); await wait();
      answer('rate'); await wait();
      out.rateError = q('#fb-error').textContent;
      click('#fb-send'); await wait();
      answer('unavailable'); await wait();
      out.unavailableError = q('#fb-error').textContent;
      click('[data-fb="close"]'); await wait();
      click('#row-feedback'); await wait();
      out.errorAfterReopen = q('#fb-error') && q('#fb-error').textContent;
    `)
    assert.equal(result.emailError, 'هذا البريد لا يبدو صحيحًا.')
    assert.equal(result.sentAfterBadEmail, 0)
    assert.equal(result.failError, 'تعذّر الإرسال. تحقّق من اتصالك وحاول مجددًا.')
    assert.equal(result.kept, 'اقتراح: زر للنسخ')
    assert.equal(result.sendEnabled, true)
    assert.equal(result.rateError, 'رسائل كثيرة. حاول بعد دقيقة.')
    assert.equal(result.unavailableError, 'إرسال الاقتراحات غير متاح الآن. حاول لاحقًا.')
    assert.equal(result.errorAfterReopen, 'إرسال الاقتراحات غير متاح الآن. حاول لاحقًا.')
    const posted = { type: 'sendFeedback', kind: 'suggestion', text: 'اقتراح: زر للنسخ', email: 'me@example.com', attach: false }
    assert.deepEqual(result.sent, [posted, posted, posted])
  })

  test('leaving the tab and coming back keeps the open dialog and the draft; a send answered meanwhile shows its thanks', () => {
    const state = panelState(input())
    const first = run('en', state, `
      click('#row-feedback'); await wait();
      click('[data-kind="problem"]'); await wait();
      type('#fb-text', 'Half written');
    `)
    const again = run('en', state, `
      out.open = q('#feedback-dialog') && q('#feedback-dialog').open;
      out.text = q('#fb-text').value;
      out.kind = q('[data-kind="problem"]').getAttribute('aria-checked');
      click('#fb-send'); await wait();
    `, first.saved)
    assert.equal(again.open, true)
    assert.equal(again.text, 'Half written')
    assert.equal(again.kind, 'true')
    // The tab is hidden while sending; the extension's answer arrives with the state of the new page.
    // Another, older send of this window finished after it: each answer is found by its own id.
    const answered = panelState(input({ feedbackAnswers: [{ id: again.saved.fbPendingId, result: 'sent' }, { id: 'older1', result: 'failed' }] }))
    const back = run('en', answered, `
      out.open = q('#feedback-dialog').open;
      out.title = q('#fb-title').textContent;
    `, again.saved)
    assert.equal(back.open, true)
    assert.equal(back.title, 'Thank you. Your message reached us.')
    assert.equal(back.saved.draft.text, '')

    // Leaving again while the thank-you shows: it is still there on return, until closed.
    const thanksAgain = run('en', answered, `
      out.title = q('#fb-title').textContent;
      click('[data-fb="close"]'); await wait();
      click('#row-feedback'); await wait();
      out.afterClose = !!q('#fb-text');
    `, back.saved)
    assert.equal(thanksAgain.title, 'Thank you. Your message reached us.')
    assert.equal(thanksAgain.afterClose, true)
  })

  test('an open dialog is not brought back if the user hid the button meanwhile', () => {
    const first = run('en', panelState(input()), `
      click('#row-feedback'); await wait();
      type('#fb-text', 'Draft');
    `)
    const back = run('en', panelState(input({ feedbackButton: false })), `
      out.open = !!q('#feedback-dialog') && q('#feedback-dialog').open;
    `, first.saved)
    assert.equal(back.open, false)
  })

  test('text made only of invisible characters leaves Send off', () => {
    const result = run('en', panelState(input()), `
      click('#row-feedback'); await wait();
      type('#fb-text', '\\u0007\\u0001  ');
      out.disabled = q('#fb-send').disabled;
      type('#fb-text', '\\u0007 real words');
      out.enabledWithWords = !q('#fb-send').disabled;
    `)
    assert.equal(result.disabled, true)
    assert.equal(result.enabledWithWords, true)
  })

  test('with its switch off the row is gone; the switch posts the change', () => {
    const result = run('en', panelState(input({ feedbackButton: false })), `
      out.row = !!q('#row-feedback');
      out.switch = q('#row-feedback-button [role=switch]').getAttribute('aria-checked');
      click('#row-feedback-button [role=switch]');
    `)
    assert.equal(result.row, false)
    assert.equal(result.switch, 'false')
    assert.deepEqual(result.sent, [{ type: 'setOption', setting: 'feedbackButton', on: true }])
  })
})
