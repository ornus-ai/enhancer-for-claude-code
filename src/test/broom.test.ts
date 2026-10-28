import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import type { RecipeOptions } from '../engine/recipe.ts'
import { en } from '../i18n/en.ts'
import { BROOM_CSS_BEGIN, BROOM_JS_BEGIN, broomCss, broomScript, findBroomClasses } from '../recipes/broom.ts'
import { RECIPES } from '../recipes/index.ts'
import { RTL_CSS_BEGIN } from '../recipes/rtl.ts'
import { CHROME, runInChrome } from './chrome.ts'
import { makeTempDir } from './tmp.ts'

const tmp = () => makeTempDir('enhancer-broom-')

// Hashed classes as Claude Code ships them: one module per hash.
const CSS = [
  '.chatContainer_AbC123{line-height:1.5}',
  '.message_AbC123{padding:0}',
  '.userMessage_AbC123{margin:0}',
  '.timelineMessage_AbC123{display:block}',
  '.messagesContainer_AbC123{overflow:auto}',
  '.toolSummary_Tt1234{display:flex}',
  '.root_Tt1234{position:relative}',
  '.root_Oo9999{color:red}',
  '.thinkingSummary_Kk5678{opacity:.7}',
  '.thinking_Kk5678{margin:0}',
  '',
].join('\n')
const JS = 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";\n'
const EXT = 'module.exports = {};\n'

function fakeClaudeCode (version: string, css = CSS, js = JS) {
  const dir = path.join(tmp(), `anthropic.claude-code-${version}-test`)
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(dir, 'webview', 'index.css'), css)
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), js)
  fs.writeFileSync(path.join(dir, 'extension.js'), EXT)
  return dir
}

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, ...file.split('/')))
const snapshot = (dir: string) => ({ css: read(dir, 'webview/index.css'), js: read(dir, 'webview/index.js'), ext: read(dir, 'extension.js') })

describe('broom recipe', () => {
  test('the tool row, footer, timeline and thinking classes are the ones sharing each module hash', () => {
    assert.deepEqual(findBroomClasses(CSS, JS), {
      toolRoot: 'root_Tt1234',
      toolSummary: 'toolSummary_Tt1234',
      footerRoot: 'inputFooterV2_Ff4321',
      footerButton: 'footerButton_Ff4321',
      timeline: 'timelineMessage_AbC123',
      message: 'message_AbC123',
      messagesContainer: 'messagesContainer_AbC123',
      thinking: 'thinking_Kk5678',
    })
  })

  test('apply adds the broom blocks, and restore gives back the exact original bytes', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    const result = await engine.apply(dir, ['broom'])
    assert.deepEqual(result.outcome === 'applied' && result.features, [{ id: 'broom', outcome: 'applied' }])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.includes(BROOM_CSS_BEGIN))
    assert.ok(css.includes('.root_Tt1234.enh-broom-folded > :not(.toolSummary_Tt1234):not(.enh-broom-tg)'))
    const js = read(dir, 'webview/index.js').toString('utf8')
    assert.ok(js.includes(BROOM_JS_BEGIN))
    assert.ok(js.includes('var FOOTER_ROOT = "inputFooterV2_Ff4321"'))
    assert.ok(js.includes('var MESSAGE = "message_AbC123"'))
    assert.equal(read(dir, 'extension.js').toString('utf8'), EXT)

    const status = await engine.status(dir)
    assert.ok('files' in status && status.files === 'enhanced' && status.appliedFeatures.includes('broom'))
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })

  test('changing a broom choice in the panel rewrites the broom script on the next apply; the files stay Enhancer\'s own and restore exactly', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    let options: RecipeOptions = { broomStartsOn: false, broomButton: true, text: en }
    const engine = new Engine(tmp(), RECIPES, () => options)
    await engine.apply(dir, ['rtl', 'broom'])
    const js = () => read(dir, 'webview/index.js').toString('utf8')
    assert.ok(js().includes('var STARTS_ON = false;') && js().includes('var SHOW_BUTTON = true;'))

    options = { broomStartsOn: true, broomButton: false, text: en }
    const changed = await engine.apply(dir, ['rtl', 'broom'])
    assert.equal(changed.outcome === 'applied' && changed.changed, true)
    assert.ok(js().includes('var STARTS_ON = true;') && js().includes('var SHOW_BUTTON = false;'))
    const again = await engine.apply(dir, ['rtl', 'broom'])
    assert.equal(again.outcome === 'applied' && again.changed, false)

    const status = await engine.status(dir)
    assert.ok('files' in status && status.files === 'enhanced')
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })

  test('a version without the tool row class fails only the broom; Arabic still applies', async () => {
    const dir = fakeClaudeCode('2.1.301', CSS.replace('.toolSummary_Tt1234{display:flex}\n', ''))
    const engine = new Engine(tmp(), RECIPES)
    const result = await engine.apply(dir, ['rtl', 'broom'])
    assert.equal(result.outcome, 'applied')
    const features = result.outcome === 'applied' ? result.features : []
    assert.equal(features.find(f => f.id === 'rtl')?.outcome, 'applied')
    assert.equal(features.find(f => f.id === 'broom')?.outcome, 'failed')
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.includes(RTL_CSS_BEGIN))
    assert.ok(!css.includes(BROOM_CSS_BEGIN))
    assert.ok(!read(dir, 'webview/index.js').toString('utf8').includes(BROOM_JS_BEGIN))
  })

  test('each missing anchor is named in the failure', () => {
    assert.throws(() => findBroomClasses(CSS.replace('.toolSummary_Tt1234{display:flex}\n', ''), JS), /toolSummary not found/)
    assert.throws(() => findBroomClasses(CSS.replace('.root_Tt1234{position:relative}\n', ''), JS), /root_Tt1234 not found beside toolSummary_Tt1234/)
    assert.throws(() => findBroomClasses(CSS, 'var b="inputFooterV2_Ff4321";\n'), /footerButton not found/)
  })

  test('two different tool row modules are ambiguous and fail instead of guessing', () => {
    assert.throws(() => findBroomClasses(`${CSS}.toolSummary_Xx0000{}\n.root_Xx0000{}\n`, JS), /toolSummary: 2 different classes/)
  })

  test('a footer button module with no footer beside it fails the broom', () => {
    assert.throws(() => findBroomClasses(CSS, 'var a="footerButton_Ff4321";\n'), /inputFooterV2_Ff4321 not found/)
  })

  test('without timeline and thinking classes the broom still applies (tool rows only)', () => {
    const css = CSS.split('\n').filter(l => !/timelineMessage|thinking/.test(l)).join('\n')
    const classes = findBroomClasses(css, JS)
    assert.equal(classes.timeline, undefined)
    assert.equal(classes.thinking, undefined)
    const script = broomScript(classes)
    assert.ok(script.includes('var TIMELINE = "";'))
    assert.ok(script.includes('var THINKING = "";'))
  })

  test('applying Arabic and the broom together, then only Arabic, leaves no broom behind', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const engine = new Engine(tmp(), RECIPES)
    await engine.apply(dir, ['rtl', 'broom'])
    await engine.apply(dir, ['rtl'])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.includes(RTL_CSS_BEGIN))
    assert.ok(!css.includes(BROOM_CSS_BEGIN))
  })
})

// The pristine copies the owner's prototype saved, when present on this machine.
const PROTOTYPE_BASELINES = path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeInjector', 'baselines')
for (const version of ['2.1.296', '2.1.300', '2.1.301']) {
  const source = path.join(PROTOTYPE_BASELINES, `anthropic.claude-code-${version}-darwin-arm64`)
  test(`real Claude Code ${version}: Arabic and the broom apply together and restore is byte-exact`, { skip: !fs.existsSync(source) && 'no pristine copy on this machine' }, async () => {
    const dir = path.join(tmp(), path.basename(source))
    fs.cpSync(source, dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)

    const result = await engine.apply(dir, ['rtl', 'broom'])
    assert.deepEqual(result.outcome === 'applied' && result.features, [{ id: 'rtl', outcome: 'applied' }, { id: 'broom', outcome: 'applied' }])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.includes('.root_ZUQaOA.enh-broom-folded > :not(.toolSummary_ZUQaOA)'))
    const js = read(dir, 'webview/index.js').toString('utf8')
    assert.ok(js.includes('var FOOTER_ROOT = "inputFooterV2_gGYT1w"'))
    assert.ok(js.includes('var THINKING = "thinking_aHyQPQ"'))
    assert.ok(js.includes('var MSG_CONTAINER = "messagesContainer_07S1Yg"'))
    assert.ok(js.includes('var MESSAGE = "message_07S1Yg"'))

    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
}

// ---- behaviour in a real browser ------------------------------------------------
// The injected CSS and script run on a page shaped like Claude Code's chat (the same
// hashed classes, a tool row with a body, finished and live thinking rows, the composer
// footer). The page drives the broom like a person and records what it sees.

const CHAT = `
<div class="messagesContainer_AbC123" style="height:400px;overflow:auto">
  <div class="timelineMessage_AbC123"><div class="message_AbC123">Hello</div></div>
  <div class="timelineMessage_AbC123" id="tool-msg"><div class="message_AbC123">
    <div class="root_Tt1234" id="tool1"><div class="toolSummary_Tt1234">Bash  List files</div><div class="body" id="tool1-body">IN ls<br>OUT a b c</div></div>
  </div></div>
  <div class="timelineMessage_AbC123" id="tool-msg2"><div class="message_AbC123">
    <div class="root_Tt1234" id="tool2"><div class="toolSummary_Tt1234">Read  notes.md</div><div class="body" id="tool2-body">line 1</div></div>
  </div></div>
  <div class="timelineMessage_AbC123" id="think-done"><div class="thinking_Kk5678"><summary>Thought for 3s</summary><div>plan</div></div></div>
  <div class="timelineMessage_AbC123" id="think-live"><div class="thinking_Kk5678"><summary>Thinking…</summary></div></div>
  <div class="timelineMessage_AbC123"><div class="message_AbC123">Done</div></div>
</div>
<div class="inputFooterV2_Ff4321" id="footer"><button class="footerButton_Ff4321" id="send">Send</button></div>`

// Runs in the page: each step waits a frame (the broom scans once per frame).
const DRIVER = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var shown = function (id) { return getComputedStyle(document.getElementById(id)).display !== 'none'; };
  try {
    await frame(); await frame();
    var footer = document.getElementById('footer');
    var broom = footer.querySelector('[data-enh-broom]');
    out.broomFirstInFooter = !!broom && footer.firstChild === broom;
    out.toggleOnEachTool = !!document.querySelector('#tool1 > .enh-broom-tg') && !!document.querySelector('#tool2 > .enh-broom-tg');
    out.startOpen = shown('tool1-body') && shown('think-done');

    var state = function () { return { on: broom.classList.contains('enh-broom-auto'), pressed: broom.getAttribute('aria-pressed') }; };
    var addTool = function (id) {
      var msg = document.createElement('div');
      msg.className = 'timelineMessage_AbC123';
      msg.innerHTML = '<div class="message_AbC123"><div class="root_Tt1234" id="' + id + '"><div class="toolSummary_Tt1234">Bash</div><div class="body" id="' + id + '-body">IN pwd</div></div></div>';
      document.querySelector('.messagesContainer_AbC123').appendChild(msg);
    };
    out.startOff = state();

    broom.click(); await frame();
    out.afterOneClick = { state: state(), tool1Body: shown('tool1-body'), tool2Body: shown('tool2-body'), tool1Header: shown('tool1'), thinkDone: shown('think-done'), thinkLive: shown('think-live') };

    addTool('tool3'); await frame(); await frame();
    out.newRowWhileOn = shown('tool3-body');

    document.querySelector('#tool1 > .enh-broom-tg').click(); await frame();
    out.afterRowToggle = { tool1Body: shown('tool1-body'), tool2Body: shown('tool2-body') };
    document.querySelector('#tool1 > .enh-broom-tg').click(); await frame();
    out.afterRowToggleBack = shown('tool1-body');

    broom.click(); await frame();
    out.afterSecondClick = { state: state(), tool1Body: shown('tool1-body'), tool2Body: shown('tool2-body'), tool3Body: shown('tool3-body'), thinkDone: shown('think-done') };

    addTool('tool4'); await frame(); await frame();
    out.newRowWhileOff = shown('tool4-body');

    // A long press is just a click: it turns the broom on once, never on and off again.
    broom.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    await wait(400);
    broom.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    broom.click(); await frame();
    out.afterLongPress = { state: state(), tool1Body: shown('tool1-body') };
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

/** Loads `chat` with the broom in headless Chrome, runs `driver`, and returns what it recorded. */
function runBroom (chat: string, driver: string) {
  const classes = findBroomClasses(CSS, JS)
  return runInChrome({ css: broomCss(classes), scripts: [broomScript(classes)], body: chat, driver })
}

// A subagent's log: tool rows inside a pane with its own scrolling, over the main chat.
const CHAT_WITH_PANE = `
<div class="messagesContainer_AbC123" id="main" style="height:200px;overflow:auto">
  <div class="timelineMessage_AbC123"><div class="message_AbC123" style="height:600px">Long answer</div></div>
</div>
<div id="pane" style="position:fixed;top:0;left:0;width:300px;height:100px;overflow:auto">
  <div style="height:300px">earlier log</div>
  <div class="root_Tt1234" id="pane-tool"><div class="toolSummary_Tt1234">Bash</div><div class="body" style="height:200px">OUT</div></div>
</div>
<div class="inputFooterV2_Ff4321"></div>`

const PANE_DRIVER = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  try {
    await frame(); await frame();
    var main = document.getElementById('main'), pane = document.getElementById('pane');
    main.scrollTop = 150;
    pane.scrollTop = pane.scrollHeight;
    out.mainBefore = main.scrollTop;
    document.querySelector('#pane-tool > .enh-broom-tg').click(); await frame();
    out.mainAfter = main.scrollTop;
    out.paneRowFolded = document.getElementById('pane-tool').classList.contains('enh-broom-folded');
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

const SAVED_ON_DRIVER = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  var shown = function (id) { return getComputedStyle(document.getElementById(id)).display !== 'none'; };
  try {
    await frame(); await frame();
    var broom = document.querySelector('[data-enh-broom]');
    var look = function () { return { on: broom.classList.contains('enh-broom-auto'), pressed: broom.getAttribute('aria-pressed'), tool1Body: shown('tool1-body'), thinkDone: shown('think-done') }; };
    out.atLoad = look();
    broom.click(); await frame();
    out.afterFirstClick = look();
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

// Claude Code's own footer rules that compete with the broom's (2.1.301): text footer buttons
// get a right padding and hide their icon, square buttons (+, /) are 26px in the primary colour.
const FOOTER_CSS = `
:root { --app-primary-foreground: rgb(204, 204, 204); --app-secondary-foreground: rgb(157, 157, 157); --vscode-inputOption-activeBackground: rgb(36, 137, 219); --vscode-inputOption-activeBorder: rgb(0, 122, 204); }
.footerButton_Ff4321 { color: var(--app-secondary-foreground); display: inline-flex; align-items: center; background: none; border: none; padding: 2px 4px; font-size: .85em; }
.footerButton_Ff4321 svg { display: none; height: 1em; }
.inputFooterV2_Ff4321 { display: flex; gap: 2px; }
.inputFooterV2_Ff4321 .footerButton_Ff4321 { box-sizing: border-box; height: 26px; padding: 0 8px 0 0; }
.inputFooterV2_Ff4321 .footerButton_Ff4321 svg { width: 26px; height: 26px; }
.inputFooterV2_Ff4321 .menuButton_Ff4321 { color: var(--app-primary-foreground); width: 26px; height: 26px; padding: 0; border: none; background: none; }`

const FOOTER_DRIVER = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  var look = function (el) {
    var s = getComputedStyle(el), svg = el.querySelector('svg'), b = svg && svg.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, color: s.color, paddingRight: s.paddingRight, icon: b ? b.width + 'x' + b.height : 'none' };
  };
  try {
    await frame(); await frame();
    var broom = document.querySelector('[data-enh-broom]');
    var svg = broom.querySelector('svg');
    out.drawing = { viewBox: svg.getAttribute('viewBox'), fill: svg.getAttribute('fill'), line: svg.getAttribute('stroke-width') };
    out.off = look(broom);
    out.slash = look(document.getElementById('slash'));
    out.offBorder = getComputedStyle(broom).boxShadow;
    broom.click(); await frame();
    out.onBackground = getComputedStyle(broom).backgroundColor;
    out.onBorder = getComputedStyle(broom).boxShadow;
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

describe('broom behaviour in a browser', { skip: !CHROME && 'Chrome is not installed on this machine' }, () => {
  test('one click turns the broom on (all folded, new rows too), one click turns it off (all open); no long press', () => {
    assert.deepEqual(runBroom(CHAT, DRIVER), {
      broomFirstInFooter: true,
      toggleOnEachTool: true,
      startOpen: true,
      startOff: { on: false, pressed: 'false' },
      afterOneClick: { state: { on: true, pressed: 'true' }, tool1Body: false, tool2Body: false, tool1Header: true, thinkDone: false, thinkLive: true },
      newRowWhileOn: false,
      afterRowToggle: { tool1Body: true, tool2Body: false },
      afterRowToggleBack: false,
      afterSecondClick: { state: { on: false, pressed: 'false' }, tool1Body: true, tool2Body: true, tool3Body: true, thinkDone: true },
      newRowWhileOff: true,
      afterLongPress: { state: { on: true, pressed: 'true' }, tool1Body: false },
    })
  })

  test('with broom on by default the chat opens with the broom on: rows on screen are folded, and the first click turns it off', () => {
    const classes = findBroomClasses(CSS, JS)
    const startsOn = broomScript(classes, { broomStartsOn: true, broomButton: true, text: en })
    assert.deepEqual(runInChrome({ css: broomCss(classes), scripts: [startsOn], body: CHAT, driver: SAVED_ON_DRIVER }), {
      atLoad: { on: true, pressed: 'true', tool1Body: false, thinkDone: false },
      afterFirstClick: { on: false, pressed: 'false', tool1Body: true, thinkDone: true },
    })
  })

  test('a click no longer outlives the chat: an on state left from an earlier version does not turn the broom on', () => {
    const classes = findBroomClasses(CSS, JS)
    const leftOver = 'window.localStorage.setItem("enhancerBroomAuto", "1");'
    const atLoad = runInChrome({ css: broomCss(classes), scripts: [leftOver, broomScript(classes)], body: CHAT, driver: SAVED_ON_DRIVER }).atLoad
    assert.deepEqual(atLoad, { on: false, pressed: 'false', tool1Body: true, thinkDone: true })
  })

  test('with the broom icon hidden: no button in the footer, the −/+ per row still folds, and on by default still folds at start', () => {
    const classes = findBroomClasses(CSS, JS)
    const driver = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  var shown = function (id) { return getComputedStyle(document.getElementById(id)).display !== 'none'; };
  try {
    await frame(); await frame();
    out.buttons = document.querySelectorAll('[data-enh-broom]').length;
    out.footer = [].map.call(document.getElementById('footer').children, function (c) { return c.id; });
    out.atLoad = { tool1Body: shown('tool1-body'), thinkDone: shown('think-done') };
    document.querySelector('#tool1 > .enh-broom-tg').click(); await frame();
    out.afterRowToggle = { tool1Body: shown('tool1-body'), tool2Body: shown('tool2-body') };
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`
    const hiddenOff = broomScript(classes, { broomStartsOn: false, broomButton: false, text: en })
    assert.deepEqual(runInChrome({ css: broomCss(classes), scripts: [hiddenOff], body: CHAT, driver }), {
      buttons: 0, footer: ['send'], atLoad: { tool1Body: true, thinkDone: true }, afterRowToggle: { tool1Body: false, tool2Body: true },
    })
    const hiddenOn = broomScript(classes, { broomStartsOn: true, broomButton: false, text: en })
    assert.deepEqual(runInChrome({ css: broomCss(classes), scripts: [hiddenOn], body: CHAT, driver }), {
      buttons: 0, footer: ['send'], atLoad: { tool1Body: false, thinkDone: false }, afterRowToggle: { tool1Body: true, tool2Body: false },
    })
  })

  test('the broom button is drawn like the footer buttons beside it: same square, same colour, a thin outline icon', () => {
    const classes = findBroomClasses(CSS, JS)
    const footer = '<div class="inputFooterV2_Ff4321" id="footer"><button class="menuButton_Ff4321" id="slash"><svg viewBox="0 0 20 20" width="26" height="26"></svg></button></div>'
    assert.deepEqual(runInChrome({ css: FOOTER_CSS + broomCss(classes), scripts: [broomScript(classes)], body: footer, driver: FOOTER_DRIVER }), {
      drawing: { viewBox: '0 0 20 20', fill: 'none', line: '1' },
      off: { width: 26, height: 26, color: 'rgb(204, 204, 204)', paddingRight: '0px', icon: '26x26' },
      slash: { width: 26, height: 26, color: 'rgb(204, 204, 204)', paddingRight: '0px', icon: '26x26' },
      offBorder: 'none',
      onBackground: 'rgb(36, 137, 219)',
      onBorder: 'rgb(0, 122, 204) 0px 0px 0px 1px inset',
    })
  })

  test('in a high-contrast theme (transparent toggle background, border only) the broom still shows when it is on', () => {
    const classes = findBroomClasses(CSS, JS)
    const footer = '<div class="inputFooterV2_Ff4321" id="footer"><button class="menuButton_Ff4321" id="slash"><svg viewBox="0 0 20 20" width="26" height="26"></svg></button></div>'
    const highContrast = FOOTER_CSS + ':root { --vscode-inputOption-activeBackground: transparent; --vscode-inputOption-activeBorder: rgb(111, 195, 223); }'
    const result = runInChrome({ css: highContrast + broomCss(classes), scripts: [broomScript(classes)], body: footer, driver: FOOTER_DRIVER })
    assert.equal(result.offBorder, 'none')
    assert.equal(result.onBorder, 'rgb(111, 195, 223) 0px 0px 0px 1px inset')
  })

  test('folding a row inside a subagent log pane leaves the main chat where it was', () => {
    assert.deepEqual(runBroom(CHAT_WITH_PANE, PANE_DRIVER), { mainBefore: 150, mainAfter: 150, paneRowFolded: true })
  })
})
