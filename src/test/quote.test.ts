import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import { RECIPES } from '../recipes/index.ts'
import {
  QUOTE_REPLY_CSS, QUOTE_REPLY_CSS_BEGIN, QUOTE_REPLY_CSS_END, QUOTE_REPLY_JS_BEGIN, QUOTE_REPLY_JS_END, findQuoteReplyClasses,
  quoteReplyRecipe, quoteReplyScript,
} from '../recipes/quoteReply.ts'
import {
  QUOTE_TOOLS_CSS, QUOTE_TOOLS_CSS_BEGIN, QUOTE_TOOLS_CSS_END, QUOTE_TOOLS_JS_BEGIN, QUOTE_TOOLS_JS_END, quoteToolsScript,
  quoteToolsRecipe,
} from '../recipes/quoteTools.ts'
import { CHROME, runInChrome } from './chrome.ts'
import { makeTempDir } from './tmp.ts'

const tmp = () => makeTempDir('enhancer-quote-')

const CSS = [
  '.chatContainer_AbC123{line-height:1.5}',
  '.message_AbC123{padding:0}',
  '.message_Zz9999{color:red}',
  '.messageInput_Qq1111{color:inherit}',
  '',
].join('\n')
const JS = 'console.log("webview");\n'

function fakeClaudeCode (version: string, css = CSS) {
  const dir = path.join(tmp(), `anthropic.claude-code-${version}-test`)
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(dir, 'webview', 'index.css'), css)
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), JS)
  fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
  return dir
}

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, ...file.split('/')))
const snapshot = (dir: string) => ({ css: read(dir, 'webview/index.css'), js: read(dir, 'webview/index.js'), ext: read(dir, 'extension.js') })

describe('quote recipes', () => {
  test('quote reply watches the chat message class beside the chat container, and the one composer', () => {
    assert.deepEqual(findQuoteReplyClasses(CSS), { message: 'message_AbC123', messageInput: 'messageInput_Qq1111' })
  })

  test('two composer classes are ambiguous and fail quote reply instead of guessing', () => {
    assert.throws(() => findQuoteReplyClasses(`${CSS}.messageInput_Ww2222{}\n`), /messageInput: 2 classes, expected exactly 1/)
  })

  test('each missing or doubled anchor is named in the quote reply failure', () => {
    assert.throws(() => findQuoteReplyClasses(CSS.replace('.chatContainer_AbC123{line-height:1.5}\n', '')), /chatContainer: 0 classes, expected exactly 1/)
    assert.throws(() => findQuoteReplyClasses(`${CSS}.chatContainer_Yy7777{}\n`), /chatContainer: 2 classes, expected exactly 1/)
    assert.throws(() => findQuoteReplyClasses(CSS.replace('.message_AbC123{padding:0}\n', '')), /message_AbC123 not found beside chatContainer_AbC123/)
  })

  for (const recipe of [quoteReplyRecipe, quoteToolsRecipe]) {
    test(`${recipe.id}: a missing webview file is named in the failure`, () => {
      assert.throws(() => recipe.apply({ 'webview/index.js': JS }), /webview\/index.css is missing/)
      assert.throws(() => recipe.apply({ 'webview/index.css': CSS }), /webview\/index.js is missing/)
    })
  }

  const blocks = [
    { recipe: quoteReplyRecipe, css: [QUOTE_REPLY_CSS_BEGIN, QUOTE_REPLY_CSS_END], js: [QUOTE_REPLY_JS_BEGIN, QUOTE_REPLY_JS_END], name: 'quote reply' },
    { recipe: quoteToolsRecipe, css: [QUOTE_TOOLS_CSS_BEGIN, QUOTE_TOOLS_CSS_END], js: [QUOTE_TOOLS_JS_BEGIN, QUOTE_TOOLS_JS_END], name: 'quote tools' },
  ]
  for (const { recipe, css, js, name } of blocks) {
    test(`${recipe.id}: output without its blocks, or with a script that does not parse, is refused`, () => {
      const good = recipe.apply({ 'webview/index.css': CSS, 'webview/index.js': JS })
      assert.doesNotThrow(() => recipe.validate!({}, good))
      assert.throws(() => recipe.validate!({}, { ...good, 'webview/index.js': JS }), new RegExp(`the ${name} script block is missing`))
      assert.throws(() => recipe.validate!({}, { ...good, 'webview/index.css': CSS }), new RegExp(`the ${name} style block is missing`))
      assert.throws(() => recipe.validate!({}, { ...good, 'webview/index.css': `${CSS}${css[0]}\n.x{}\n` }), new RegExp(`the ${name} style block is missing`))
      assert.throws(() => recipe.validate!({}, { ...good, 'webview/index.js': `${JS};${js[0]}\n;(function(){\n;${js[1]}\n` }), SyntaxError)
    })

    test(`${recipe.id}: a script block at the very start of an empty bundle is accepted`, () => {
      const after = { 'webview/index.css': `${css[0]}\n.x{}\n${css[1]}\n`, 'webview/index.js': `${js[0]}\n;(function(){})();\n;${js[1]}\n` }
      assert.doesNotThrow(() => recipe.validate!({}, after))
    })
  }

  test('without the chat container quote reply fails alone; quote tools (no anchors) still apply', async () => {
    const dir = fakeClaudeCode('2.1.301', CSS.replace('.chatContainer_AbC123{line-height:1.5}\n', ''))
    const result = await new Engine(tmp(), RECIPES).apply(dir, ['quoteReply', 'quoteTools'])
    const features = result.outcome === 'applied' ? result.features : []
    assert.deepEqual(features.map(f => [f.id, f.outcome]), [['quoteReply', 'failed'], ['quoteTools', 'applied']])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(!css.includes(QUOTE_REPLY_CSS_BEGIN))
    assert.ok(css.includes(QUOTE_TOOLS_CSS_BEGIN))
  })

  test('apply adds both blocks, status names both, and restore gives back the exact original bytes', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    await engine.apply(dir, ['quoteReply', 'quoteTools'])
    const js = read(dir, 'webview/index.js').toString('utf8')
    assert.ok(js.includes(QUOTE_REPLY_JS_BEGIN))
    assert.ok(js.includes('var MSG_CLASS = "message_AbC123"'))
    assert.ok(js.includes('var INPUT_CLASS = "messageInput_Qq1111"'))
    const status = await engine.status(dir)
    assert.ok('files' in status)
    assert.equal(status.files, 'enhanced')
    assert.deepEqual(status.appliedFeatures, ['quoteReply', 'quoteTools'])
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
})

// The pristine copies the owner's prototype saved, when present on this machine.
const PROTOTYPE_BASELINES = path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeInjector', 'baselines')
for (const version of ['2.1.296', '2.1.300', '2.1.301']) {
  const source = path.join(PROTOTYPE_BASELINES, `anthropic.claude-code-${version}-darwin-arm64`)
  test(`real Claude Code ${version}: all four features apply together and restore is byte-exact`, { skip: !fs.existsSync(source) && 'no pristine copy on this machine' }, async () => {
    const dir = path.join(tmp(), path.basename(source))
    fs.cpSync(source, dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)

    const result = await engine.apply(dir, ['rtl', 'broom', 'quoteReply', 'quoteTools'])
    assert.deepEqual(result.outcome === 'applied' && result.features.map(f => [f.id, f.outcome]),
      [['rtl', 'applied'], ['broom', 'applied'], ['quoteReply', 'applied'], ['quoteTools', 'applied']])
    const js = read(dir, 'webview/index.js').toString('utf8')
    assert.ok(js.includes('var MSG_CLASS = "message_07S1Yg"'))
    assert.ok(js.includes('var INPUT_CLASS = "messageInput_cKsPxg"'))
    const status = await engine.status(dir)
    assert.ok('files' in status && status.files === 'enhanced')

    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
}

// A Claude Code version newer than the recipes were written for, as installed in Devin
// (copied, never changed in place): every feature is tried on it (owner, 2026-10-17).
const DEVIN_302 = path.join(os.homedir(), '.devin', 'extensions', 'anthropic.claude-code-2.1.302-darwin-arm64')
const devin302Pristine = fs.existsSync(DEVIN_302) &&
  !['webview/index.css', 'webview/index.js', 'extension.js'].some(f => / BEGIN \*\//.test(read(DEVIN_302, f).toString('utf8')))
test('real Claude Code 2.1.302 (newer than the recipes): all four features apply together and restore is byte-exact', { skip: !devin302Pristine && 'no pristine 2.1.302 on this machine' }, async () => {
  const dir = path.join(tmp(), path.basename(DEVIN_302))
  fs.cpSync(DEVIN_302, dir, { recursive: true })
  const before = snapshot(dir)
  const engine = new Engine(tmp(), RECIPES)

  const result = await engine.apply(dir, ['rtl', 'broom', 'quoteReply', 'quoteTools'])
  assert.deepEqual(result.outcome === 'applied' && result.features.map(f => [f.id, f.outcome]),
    [['rtl', 'applied'], ['broom', 'applied'], ['quoteReply', 'applied'], ['quoteTools', 'applied']])
  const status = await engine.status(dir)
  assert.ok('files' in status && status.files === 'enhanced')

  await engine.restore(dir)
  assert.deepEqual(snapshot(dir), before)
})

// ---- behaviour in a real browser ------------------------------------------------

// A Claude reply, a text outside the chat, and the composer inside its form. The form's
// own keydown handler stands in for Claude Code's: it records the composer's text as
// sent and, when sending works, empties the composer.
const QUOTE_REPLY_PAGE = `
<div class="chatContainer_AbC123">
  <div class="message_AbC123" id="reply"><p id="p1">Use the second option please</p><p id="p2">Then run the tests</p></div>
</div>
<div id="outside">Outside the chat</div>
<form id="form" style="margin-top:200px"><div class="messageInput_Qq1111" contenteditable="true" id="composer"></div></form>
<script>
window.__sent = null; window.__sendWorks = false;
document.getElementById('form').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  var c = document.getElementById('composer');
  window.__sent = c.textContent;
  if (window.__sendWorks) c.textContent = '';
});
</script>`

const QUOTE_REPLY_DRIVER = `
(async function () {
  var out = {};
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var bar = function () { return document.querySelector('.enh-quote-bar'); };
  var shown = function (el) { return !!el && getComputedStyle(el).display !== 'none'; };
  var composer = document.getElementById('composer');
  function select(id, from, to) {
    var t = document.getElementById(id).firstChild;
    var r = document.createRange(); r.setStart(t, from); r.setEnd(t, to);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function button(label) {
    return Array.prototype.filter.call(bar().querySelectorAll('button'), function (b) { return b.getAttribute('aria-label') === label; })[0];
  }
  function cards() { return Array.prototype.map.call(document.querySelectorAll('.enh-quote-chip-text'), function (c) { return c.textContent; }); }
  function enter() { composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
  try {
    await wait(50);
    select('p1', 8, 21); await wait(250);
    out.barOnSelection = shown(bar());

    button('Copy').click(); await wait(50);
    out.copied = window.__copied;
    out.copyLabel = button('Copy').textContent;

    select('p1', 8, 21); await wait(250);
    button('Reply').click(); await wait(50);
    out.afterReply = { cards: cards(), trayShown: shown(document.querySelector('.enh-quote-tray')), composer: composer.textContent };

    composer.textContent = 'I agree';
    enter(); await wait(120);
    out.sendFailed = { sent: window.__sent.slice(), composer: composer.textContent, cards: cards() };

    window.__sendWorks = true;
    enter(); await wait(120);
    out.sendWorked = { sent: window.__sent, composer: composer.textContent, cards: cards(), trayShown: shown(document.querySelector('.enh-quote-tray')) };

    select('p1', 0, 3); await wait(250); button('Reply').click(); await wait(50);
    select('p2', 9, 18); await wait(250); button('Reply').click(); await wait(50);
    out.twoCards = cards();
    document.querySelector('.enh-quote-chip-x').click(); await wait(50);
    out.afterRemove = cards();

    getSelection().removeAllRanges(); await wait(250);
    select('outside', 0, 7); await wait(250);
    out.barOutsideChat = shown(bar());
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

const QUOTE_TOOLS_PAGE = `
<div class="message_AbC123"><blockquote id="q1"><p>line one</p><p>line two</p></blockquote></div>
<div contenteditable="true"><blockquote id="q2"><p>draft</p></blockquote></div>`

const QUOTE_TOOLS_DRIVER = `
(async function () {
  var out = {};
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var q1 = document.getElementById('q1');
  function button(label) { return q1.querySelector('.enh-qt-btn[data-label="' + label + '"]'); }
  try {
    await wait(100);
    out.barFirst = !!q1.firstChild.classList && q1.firstChild.classList.contains('enh-qt-bar');
    out.editableQuoteLeftAlone = !document.querySelector('#q2 .enh-qt-bar');

    button('Select').click(); await wait(20);
    out.selected = getSelection().toString();
    out.selectLabel = button('Select').textContent;

    getSelection().removeAllRanges();
    button('Copy').click(); await wait(50);
    out.copied = window.__copied;
    out.copyLabel = button('Copy').textContent;
    out.selectionClearedAfterCopy = getSelection().rangeCount === 0;

    var p = document.createElement('p'); p.textContent = 'line zero';
    q1.insertBefore(p, q1.firstChild); await wait(150);
    out.barFirstAfterRerender = q1.firstChild.classList && q1.firstChild.classList.contains('enh-qt-bar');
    out.oneBar = q1.querySelectorAll('.enh-qt-bar').length;
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

// The same chat, but the composer's own Enter handler behaves in two harder ways Claude
// Code could: it submits the form before reading the text (window.__mode = 'submit'), or
// a failed send rebuilds the composer's text node keeping the text (window.__mode = 'rebuild').
const QUOTE_REPLY_HARD_PAGE = `
<div class="chatContainer_AbC123">
  <div class="message_AbC123" id="reply"><p id="p1">Use the second option please</p></div>
</div>
<form id="form" style="margin-top:200px"><div class="messageInput_Qq1111" contenteditable="true" id="composer"></div></form>
<script>
window.__sent = []; window.__mode = 'submit'; window.__sendWorks = false;
var form = document.getElementById('form'), composer = document.getElementById('composer');
form.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (window.__mode === 'submit') { form.requestSubmit(); return; }
  var text = composer.textContent;
  window.__sent.push(text);
  if (window.__sendWorks) { composer.textContent = ''; return; }
  composer.textContent = '';
  composer.appendChild(document.createTextNode(text));
});
form.addEventListener('submit', function (e) {
  e.preventDefault();
  window.__sent.push(composer.textContent);
  if (window.__sendWorks) composer.textContent = '';
});
</script>`

const QUOTE_REPLY_HARD_DRIVER = `
(async function () {
  var out = {};
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var composer = document.getElementById('composer');
  function quote() {
    var t = document.getElementById('p1').firstChild;
    var r = document.createRange(); r.setStart(t, 8); r.setEnd(t, 21);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function reply() {
    return Array.prototype.filter.call(document.querySelectorAll('.enh-quote-bar button'), function (b) { return b.getAttribute('aria-label') === 'Reply'; })[0];
  }
  function cards() { return document.querySelectorAll('.enh-quote-chip').length; }
  function enter() { composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); }
  try {
    await wait(50);
    quote(); await wait(250); reply().click(); await wait(50);
    composer.textContent = 'hello';
    window.__mode = 'submit'; window.__sendWorks = true;
    enter(); await wait(120);
    out.submitInsideEnter = { sent: window.__sent.slice(), composer: composer.textContent, cards: cards() };

    window.__sent = [];
    quote(); await wait(250); reply().click(); await wait(50);
    composer.textContent = 'hello';
    window.__mode = 'rebuild'; window.__sendWorks = false;
    enter(); await wait(120);
    out.failedSendRebuilt = { sent: window.__sent.slice(), composer: composer.textContent, cards: cards() };
    window.__sendWorks = true;
    enter(); await wait(120);
    out.retry = { sent: window.__sent.slice(), composer: composer.textContent, cards: cards() };
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

describe('quote behaviour in a browser', { skip: !CHROME && 'Chrome is not installed on this machine' }, () => {
  test('selecting reply text offers Reply and Copy; Reply sends the quote with the next message, once', () => {
    const classes = findQuoteReplyClasses(CSS)
    const result = runInChrome({ css: QUOTE_REPLY_CSS, scripts: [quoteReplyScript(classes)], body: QUOTE_REPLY_PAGE, driver: QUOTE_REPLY_DRIVER })
    assert.deepEqual(result, {
      barOnSelection: true,
      copied: 'second option',
      copyLabel: 'Copied',
      afterReply: { cards: ['second option'], trayShown: true, composer: '' },
      sendFailed: { sent: '> second option\n\nI agree', composer: 'I agree', cards: ['second option'] },
      sendWorked: { sent: '> second option\n\nI agree', composer: '', cards: [], trayShown: false },
      twoCards: ['Use', 'the tests'],
      afterRemove: ['the tests'],
      barOutsideChat: false,
    })
  })

  test('one send attaches the quote once, and a failed send that rebuilds the composer gives the text back', () => {
    const classes = findQuoteReplyClasses(CSS)
    const result = runInChrome({ css: QUOTE_REPLY_CSS, scripts: [quoteReplyScript(classes)], body: QUOTE_REPLY_HARD_PAGE, driver: QUOTE_REPLY_HARD_DRIVER })
    assert.deepEqual(result, {
      submitInsideEnter: { sent: ['> second option\n\nhello'], composer: '', cards: 0 },
      failedSendRebuilt: { sent: ['> second option\n\nhello'], composer: 'hello', cards: 1 },
      retry: { sent: ['> second option\n\nhello', '> second option\n\nhello'], composer: '', cards: 0 },
    })
  })

  test('every chat quote gets Copy and Select that take the quote text only, and keeps them first', () => {
    const result = runInChrome({ css: QUOTE_TOOLS_CSS, scripts: [quoteToolsScript()], body: QUOTE_TOOLS_PAGE, driver: QUOTE_TOOLS_DRIVER })
    assert.deepEqual(result, {
      barFirst: true,
      editableQuoteLeftAlone: true,
      selected: 'line one\n\nline two',
      selectLabel: 'Selected',
      copied: 'line one\n\nline two',
      copyLabel: 'Copied',
      selectionClearedAfterCopy: true,
      barFirstAfterRerender: true,
      oneBar: 1,
    })
  })
})
