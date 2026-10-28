import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as vm from 'vm'
import { describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import { broomCss, broomScript, findBroomClasses } from '../recipes/broom.ts'
import {
  IMAGE_CSS, IMAGE_CSS_BEGIN, IMAGE_GUARD_OPEN, IMAGE_HOST, IMAGE_HOST_BEGIN, IMAGE_IPC_OPEN, IMAGE_OPEN_OPEN, imageScript,
  IMAGE_SHIM, IMAGE_SHIM_BEGIN, findJsxAliases, imagePreviewRecipe,
} from '../recipes/imagePreview.ts'
import { RECIPES } from '../recipes/index.ts'
import { CHROME, runInChrome } from './chrome.ts'
import { makeTempDir } from './tmp.ts'

// The modules the host block asks for; the editor API is absent here.
const NODE_MODULES: Record<string, unknown> = { fs, os, path }
const hostRequire = (name: string) => {
  if (!(name in NODE_MODULES)) throw new Error(`no ${name} here`)
  return NODE_MODULES[name]
}

const tmp = () => makeTempDir('enhancer-image-')
const ALL = RECIPES.map(r => r.id)

// Shapes as Claude Code 2.1.302 ships them (names shortened, structure verbatim).
const TOOL_ROW = 'function Tr(e){return R("div",{className:m.root,children:[F("summary",{className:m.toolSummary,children:e})]})}'
const TOOL_BODY = 'function bw5($,J,Z,X){return Nz(J.name,Z).body(Z,J.input,X===void 0?$.toolResult.value:X.result,$.progress.value,{interruptedByShutdown:$.a,toolUseResult:$.b})}'
const WEBVIEW = `var x=1;${TOOL_ROW}${TOOL_BODY}\n`
const HOST = 'class P{wire($,G){$.webview.onDidReceiveMessage((V)=>{vE(this.output,V),G?.fromClient(V)},null,this.d)}}' +
  'function openFile(z,W){try{if(p5.statSync(W).isDirectory()){F1.commands.executeCommand("revealInExplorer",z);return}}catch{G=!1}F1.window.showTextDocument(z)}\n'
const CSS = '.root_Tt1234{position:relative}\n'

const texts = (js = WEBVIEW, ext = HOST) => ({ 'webview/index.css': CSS, 'webview/index.js': js, 'extension.js': ext })

function fakeClaudeCode (js = WEBVIEW, ext = HOST) {
  const dir = path.join(tmp(), 'anthropic.claude-code-2.1.302-test')
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.1.302' }))
  fs.writeFileSync(path.join(dir, 'webview', 'index.css'), CSS)
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), js)
  fs.writeFileSync(path.join(dir, 'extension.js'), ext)
  return dir
}

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, ...file.split('/')))
const snapshot = (dir: string) => ({ css: read(dir, 'webview/index.css'), js: read(dir, 'webview/index.js'), ext: read(dir, 'extension.js') })

describe('image preview recipe', () => {
  test('the jsx helpers are read off the tool-row renderer', () => {
    assert.deepEqual(findJsxAliases(WEBVIEW), { jsx: 'F', jsxs: 'R' })
  })

  test('the tool body gets one guard in front of its own return, which stays byte-identical', () => {
    const out = imagePreviewRecipe.apply(texts())
    const js = out['webview/index.js']!
    assert.ok(js.startsWith(IMAGE_SHIM_BEGIN))
    const original = 'return Nz(J.name,Z).body(Z,J.input,X===void 0?$.toolResult.value:X.result,$.progress.value,{interruptedByShutdown:$.a,toolUseResult:$.b})}'
    assert.ok(js.includes(`function bw5($,J,Z,X){${IMAGE_GUARD_OPEN}if(window.__enhancerImageBody)return window.__enhancerImageBody(J,(X===void 0?$.toolResult.value:X.result),Nz(J.name,Z).body(`))
    assert.ok(js.includes(original))
    assert.equal(js.split(IMAGE_GUARD_OPEN).length, 2)
    assert.ok(js.includes(',F,R);/*}ENH-IMG*/return Nz('), 'jsx then jsxs are passed to the guard')
  })

  test('the older 3-parameter body (2.1.296) is wrapped too', () => {
    const older = 'function DQ5($,J,Z){return NQ(J.name,Z).body(Z,J.input,$.toolResult.value,$.progress.value,{a:$.b})}'
    const js = imagePreviewRecipe.apply(texts(`${TOOL_ROW}${older}`))['webview/index.js']!
    assert.ok(js.includes(`function DQ5($,J,Z){${IMAGE_GUARD_OPEN}if(window.__enhancerImageBody)return window.__enhancerImageBody(J,($.toolResult.value),NQ(J.name,Z).body(Z,J.input,$.toolResult.value,$.progress.value,{a:$.b}),F,R);`))
  })

  test('every webview message handler routes our two messages first; images open in the editor viewer', () => {
    const ext = imagePreviewRecipe.apply(texts(WEBVIEW, HOST + HOST.replace('class P', 'class Q')))['extension.js']!
    assert.equal(ext.split(IMAGE_IPC_OPEN).length, 3)
    assert.ok(ext.includes('onDidReceiveMessage((V)=>{/*ENH-IMG-IPC*/if(V&&(V.type==="enhImgRead"||V.type==="enhImgOpen")){if(globalThis.__enhancerImageHandle)globalThis.__enhancerImageHandle($.webview,V);return;}/*ENH-IMG-IPC-END*/vE(this.output,V)'))
    assert.ok(ext.includes(`catch{G=!1}${IMAGE_OPEN_OPEN}if(/\\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i.test(W)){F1.commands.executeCommand("vscode.open",z);return}`))
    assert.ok(ext.includes(IMAGE_HOST_BEGIN))
  })

  test('each missing or doubled anchor is named in the failure', () => {
    assert.throws(() => imagePreviewRecipe.apply(texts(TOOL_BODY)), /tool-row renderer: 0 matches/)
    assert.throws(() => imagePreviewRecipe.apply(texts(TOOL_ROW)), /tool-body renderer: 0 matches/)
    assert.throws(() => imagePreviewRecipe.apply(texts(`${TOOL_ROW}${TOOL_BODY}${TOOL_BODY.replace('bw5', 'bw6')}`)), /tool-body renderer: 2 matches/)
    assert.throws(() => imagePreviewRecipe.apply(texts(WEBVIEW, 'module.exports={}')), /message handler not found/)
    assert.throws(() => imagePreviewRecipe.apply({ 'webview/index.css': CSS, 'webview/index.js': WEBVIEW }), /extension.js is missing/)
  })

  test('without the openFile shape the feature still applies (that fix is optional)', () => {
    const ext = imagePreviewRecipe.apply(texts(WEBVIEW, HOST.replace('revealInExplorer', 'reveal')))['extension.js']!
    assert.ok(!ext.includes(IMAGE_OPEN_OPEN))
    assert.ok(ext.includes(IMAGE_IPC_OPEN))
  })

  test('output without its blocks, or with a block that does not parse, is refused', () => {
    const good = { ...texts(), ...imagePreviewRecipe.apply(texts()) }
    assert.doesNotThrow(() => imagePreviewRecipe.validate!(texts(), good))
    assert.throws(() => imagePreviewRecipe.validate!(texts(), { ...good, 'extension.js': HOST }), /host block is missing/)
    assert.throws(() => imagePreviewRecipe.validate!(texts(), { ...good, 'webview/index.css': CSS }), /style block is missing/)
    const broken = good['extension.js']!.replace('globalThis.__enhancerImageHostInstalled = true;', 'globalThis.__enhancerImageHostInstalled = (;')
    assert.throws(() => imagePreviewRecipe.validate!(texts(), { ...good, 'extension.js': broken }), SyntaxError)
  })

  test('a version where the body anchor is gone fails only image preview; the others still apply', async () => {
    const dir = fakeClaudeCode(`${TOOL_ROW}var nothing=1;\n`)
    const result = await new Engine(tmp(), RECIPES).apply(dir, ['quoteTools', 'imagePreview'])
    assert.equal(result.outcome, 'applied')
    assert.deepEqual(result.outcome === 'applied' && result.features.map(f => [f.id, f.outcome]), [['quoteTools', 'applied'], ['imagePreview', 'failed']])
    assert.ok(!read(dir, 'extension.js').toString('utf8').includes(IMAGE_IPC_OPEN), 'nothing of a failed feature is written')
  })

  test('apply writes all three files, status names it, and restore gives back the exact original bytes', async () => {
    const dir = fakeClaudeCode()
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    const result = await engine.apply(dir, ['imagePreview'])
    assert.deepEqual(result.outcome === 'applied' && result.features, [{ id: 'imagePreview', outcome: 'applied' }])
    assert.ok(read(dir, 'webview/index.css').toString('utf8').includes(IMAGE_CSS_BEGIN))
    assert.ok(read(dir, 'extension.js').toString('utf8').includes(IMAGE_HOST_BEGIN))
    const status = await engine.status(dir)
    assert.ok('files' in status && status.files === 'enhanced' && status.appliedFeatures.includes('imagePreview'))
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
})

describe('image preview: the guard and the host side', () => {
  /** The patched webview bundle run in a sandbox with stand-ins for the jsx helpers and the tool lookup. */
  function patchedBody () {
    const js = imagePreviewRecipe.apply(texts())['webview/index.js']!
    const calls: unknown[] = []
    const sandbox: Record<string, unknown> = {
      window: {},
      R: (tag: string, props: unknown) => ({ jsxs: tag, props }),
      F: (tag: string, props: unknown) => ({ jsx: tag, props }),
      Nz: () => ({ body: (...args: unknown[]) => { calls.push(args); return 'ORIGINAL' } }),
    }
    vm.runInNewContext(js, sandbox)
    // Objects made in the sandbox are compared by content (their prototypes differ).
    const bw5 = (...a: unknown[]) => JSON.parse(JSON.stringify((sandbox.bw5 as (...a: unknown[]) => unknown)(...a)))
    return { bw5, calls }
  }

  test('a tool row naming an image returns its own body plus a strip with the path', () => {
    const { bw5, calls } = patchedBody()
    const out = bw5({ toolResult: { value: 'ok' }, progress: { value: 0 } }, { id: 'toolu_1', name: 'Read', input: { file_path: '/Users/me/shot.png' } }, {}, undefined)
    assert.deepEqual(out, { jsxs: 'div', props: { className: 'enh-img-wrap', children: ['ORIGINAL', { jsx: 'div', props: { className: 'enh-img-strip', 'data-enh-imgs': '["/Users/me/shot.png"]', 'data-enh-key': 'toolu_1|1' } }] } })
    assert.equal(calls.length, 1)
  })

  test('while the call has no result yet the strip says so, so it is filled again when the result comes', () => {
    const { bw5 } = patchedBody()
    const out = bw5({ toolResult: { value: undefined }, progress: { value: 0 } }, { id: 'toolu_2', name: 'Write', input: { file_path: '/tmp/new.svg' } }, {}, undefined)
    assert.equal(out.props.children[1].props['data-enh-key'], 'toolu_2|0')
  })

  test('a tool row with no image returns exactly what Claude Code returns', () => {
    const { bw5 } = patchedBody()
    assert.equal(bw5({ toolResult: { value: 'ok' }, progress: { value: 0 } }, { name: 'Read', input: { file_path: '/Users/me/notes.md' } }, {}, undefined), 'ORIGINAL')
  })

  test('image paths in the result text are found too, Windows ones included, at most four, no duplicates', () => {
    const { bw5 } = patchedBody()
    const text = 'saved /tmp/a.png and C:\\Users\\me\\b.JPG, again /tmp/a.png, then ~/c.webp /d/e.gif /f/g.svg'
    const out = bw5({ toolResult: { value: text }, progress: { value: 0 } }, { name: 'Bash', input: { command: 'x' } }, {}, undefined)
    assert.deepEqual(JSON.parse(out.props.children[1].props['data-enh-imgs']), ['/tmp/a.png', 'C:\\Users\\me\\b.JPG', '~/c.webp', '/d/e.gif'])
  })

  /** Runs the host block with real fs/os/path and no editor API; returns its handler. */
  function host () {
    const sandbox: Record<string, unknown> = { require: hostRequire }
    sandbox.globalThis = sandbox
    vm.runInNewContext(IMAGE_HOST, sandbox)
    const handle = sandbox.__enhancerImageHandle as (w: unknown, m: unknown) => void
    return (msg: unknown) => new Promise<any>(resolve => {
      handle({ postMessage: (m: unknown) => resolve(JSON.parse(JSON.stringify(m))) }, msg)
      setTimeout(() => resolve('no answer'), 500)
    })
  }

  test('the host answers an image with a data URI of its exact bytes', async () => {
    const file = path.join(tmp(), 'shot.png')
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))
    assert.deepEqual(await host()({ type: 'enhImgRead', id: 'enhimg-1', path: file }),
      { type: 'enhImgData', id: 'enhimg-1', ok: true, dataUri: 'data:image/png;base64,iVBORw0KGgoBAgM=' })
  })

  test('the host refuses anything that is not an image, a missing file, and a file over 16 MB', async () => {
    const dir = tmp()
    const text = path.join(dir, 'secret.txt')
    fs.writeFileSync(text, 'key=1')
    const big = path.join(dir, 'big.png')
    fs.writeFileSync(big, Buffer.alloc(16 * 1024 * 1024 + 1))
    const ask = host()
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'a', path: text }), { type: 'enhImgData', id: 'a', ok: false, error: 'unsupported' })
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'b', path: path.join(dir, 'gone.png') }), { type: 'enhImgData', id: 'b', ok: false, error: 'not-found' })
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'c', path: big }), { type: 'enhImgData', id: 'c', ok: false, error: 'too-large' })
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'd', path: 'relative.png' }), { type: 'enhImgData', id: 'd', ok: false, error: 'not-found' })
  })

  test('a link named like an image that points to another file, and a text file renamed .png, are refused', async () => {
    const dir = tmp()
    const secret = path.join(dir, 'id_rsa')
    fs.writeFileSync(secret, '-----BEGIN OPENSSH PRIVATE KEY-----')
    const link = path.join(dir, 'logo.png')
    fs.symlinkSync(secret, link)
    const renamed = path.join(dir, 'notes.png')
    fs.writeFileSync(renamed, 'key=1')
    const ask = host()
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'l', path: link }), { type: 'enhImgData', id: 'l', ok: false, error: 'unsupported' })
    assert.deepEqual(await ask({ type: 'enhImgRead', id: 'r', path: renamed }), { type: 'enhImgData', id: 'r', ok: false, error: 'unsupported' })
  })

  test('an ordinary SVG with attributes and a long comment before it is read', async () => {
    const file = path.join(tmp(), 'logo.svg')
    const svg = `<?xml version="1.0"?>\n<!-- ${'x'.repeat(5000)} -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1"\n height="1"></svg>`
    fs.writeFileSync(file, svg)
    assert.deepEqual(await host()({ type: 'enhImgRead', id: 'v', path: file }),
      { type: 'enhImgData', id: 'v', ok: true, dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` })
  })

  test('a link to a real image is read from the image it points to', async () => {
    const dir = tmp()
    const real = path.join(dir, 'real.png')
    fs.writeFileSync(real, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]))
    const link = path.join(dir, 'alias.png')
    fs.symlinkSync(real, link)
    assert.deepEqual(await host()({ type: 'enhImgRead', id: 's', path: link }),
      { type: 'enhImgData', id: 's', ok: true, dataUri: 'data:image/png;base64,iVBORw0KGgoJ' })
  })

  test('the routed handler takes our two messages and passes every other one to Claude Code', () => {
    const ext = imagePreviewRecipe.apply(texts())['extension.js']!
    const handled: unknown[] = []
    const fromClient: unknown[] = []
    let listener: ((m: unknown) => void) | undefined
    const sandbox: Record<string, unknown> = { vE: () => {}, require: hostRequire, p5: fs }
    sandbox.globalThis = sandbox
    vm.runInNewContext(`${ext};globalThis.P=P;`, sandbox)
    sandbox.__enhancerImageHandle = (_w: unknown, m: unknown) => handled.push(m)
    const P = sandbox.P as new () => { wire: (a: unknown, b: unknown) => void }
    new P().wire({ webview: { onDidReceiveMessage: (cb: (m: unknown) => void) => { listener = cb } } }, { fromClient: (m: unknown) => fromClient.push(m) })
    listener!({ type: 'enhImgRead', id: '1', path: '/a.png' })
    listener!({ type: 'enhImgOpen', path: '/a.png' })
    listener!({ type: 'launch_claude' })
    assert.deepEqual(handled, [{ type: 'enhImgRead', id: '1', path: '/a.png' }, { type: 'enhImgOpen', path: '/a.png' }])
    assert.deepEqual(fromClient, [{ type: 'launch_claude' }])
  })
})

// Real Claude Code copies: the owner's prototype baselines and Devin's 2.1.302, when pristine.
const PROTOTYPE_BASELINES = path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeInjector', 'baselines')
const REAL = [
  ...['2.1.296', '2.1.300', '2.1.301'].map(v => ({ version: v, source: path.join(PROTOTYPE_BASELINES, `anthropic.claude-code-${v}-darwin-arm64`) })),
  { version: '2.1.302', source: path.join(os.homedir(), '.devin', 'extensions', 'anthropic.claude-code-2.1.302-darwin-arm64') },
]
const pristine = (dir: string) => fs.existsSync(dir) &&
  !['webview/index.css', 'webview/index.js', 'extension.js'].some(f => / BEGIN \*\//.test(read(dir, f).toString('utf8')))
for (const { version, source } of REAL) {
  test(`real Claude Code ${version}: all five features apply together, the guard sits once, and restore is byte-exact`, { skip: !pristine(source) && 'no pristine copy on this machine' }, async () => {
    const dir = path.join(tmp(), path.basename(source))
    fs.cpSync(source, dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    const result = await engine.apply(dir, ALL)
    assert.deepEqual(result.outcome === 'applied' && result.features.map(f => [f.id, f.outcome]), ALL.map(id => [id, 'applied']))
    const js = read(dir, 'webview/index.js').toString('utf8')
    const ext = read(dir, 'extension.js').toString('utf8')
    assert.equal(js.split(IMAGE_GUARD_OPEN).length, 2)
    assert.equal(ext.split(IMAGE_IPC_OPEN).length, 4, 'all three webview handlers are routed')
    assert.equal(ext.split(IMAGE_OPEN_OPEN).length, 2)
    const status = await engine.status(dir)
    assert.ok('files' in status && status.files === 'enhanced')
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
}

// ---- behaviour in a real browser ------------------------------------------------
// A 1×1 PNG, the answer the page gets for every image it asks for.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='

// Stands in for the editor: what the page posts is recorded; Claude Code's own bundle
// already took the API object (acquireVsCodeApi works once), which the shim keeps for us.
const EDITOR = `
window.__sent = [];
window.acquireVsCodeApi = (function () { var used = false; return function () { if (used) throw new Error('acquireVsCodeApi can only be called once'); used = true; return { postMessage: function (m) { window.__sent.push(m); } }; }; })();`
const CLAUDE_CODE_TAKES_API = 'window.__claudeApi = acquireVsCodeApi();'

// The jsx helpers build real DOM nodes here, so the strip the guard returns can be mounted.
const DRIVER = `
(async function () {
  var out = {};
  var frame = function () { return new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); }); };
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var make = function (tag, props) {
    var el = document.createElement(tag);
    Object.keys(props).forEach(function (k) {
      if (k === 'className') el.className = props[k];
      else if (k === 'children') props[k].forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      else el.setAttribute(k, props[k]);
    });
    return el;
  };
  var row = function (id, input, toolId, result) {
    var root = document.createElement('div');
    root.className = 'root_Tt1234'; root.id = id;
    root.innerHTML = '<div class="toolSummary_Tt1234">Read</div>';
    var body = window.__enhancerImageBody({ id: toolId, name: 'Read', input: input }, result === undefined ? 'ok' : result, make('div', { className: 'body', children: ['file body'] }), make, make);
    root.appendChild(body);
    document.getElementById('chat').appendChild(root);
    return root;
  };
  var reads = function (path) { return window.__sent.filter(function (m) { return m.type === 'enhImgRead' && m.path === path; }).length; };
  var answer = function (path, payload) {
    var req = window.__sent.filter(function (m) { return m.type === 'enhImgRead' && m.path === path; }).pop();
    window.postMessage(Object.assign({ type: 'enhImgData', id: req.id }, payload), '*');
  };
  try {
    out.claudeKeptItsApi = typeof window.__claudeApi.postMessage === 'function';
    row('tool1', { file_path: '/shots/a.png' }, 't1');
    await frame();
    out.asked = window.__sent.map(function (m) { return m.type + ' ' + m.path; });
    out.loading = !!document.querySelector('#tool1 .enh-img-tile.is-loading');
    answer('/shots/a.png', { ok: true, dataUri: '${PNG}' });
    await wait(50);
    out.thumb = !!document.querySelector('#tool1 img.enh-img-thumb');

    document.querySelector('#tool1 .enh-img-tile').click(); await frame();
    out.zoomOpen = !!document.querySelector('.enh-img-overlay img.enh-img-full');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame();
    out.zoomClosedByEsc = !document.querySelector('.enh-img-overlay');

    document.querySelector('#tool1 .enh-img-openbtn').click();
    out.openSent = window.__sent[window.__sent.length - 1];

    // The same call rendered again (React remounting it) uses the read it already has.
    row('tool2', { file_path: '/shots/a.png' }, 't1');
    await frame();
    out.sameCallReadOnce = reads('/shots/a.png') === 1 && !!document.querySelector('#tool2 img.enh-img-thumb');

    // A later call naming the same path (a screenshot saved again) reads the file afresh.
    row('tool2b', { file_path: '/shots/a.png' }, 't2');
    await frame();
    out.laterCallReadsAgain = reads('/shots/a.png') === 2;

    // An image the tool creates: not there while it runs, read again once it has a result.
    var pendingRow = row('tool4', { file_path: '/shots/new.svg' }, 't4', null);
    await frame();
    answer('/shots/new.svg', { ok: false, error: 'not-found' });
    await wait(50);
    out.whileRunning = document.querySelector('#tool4 .enh-img-errtext').textContent;
    pendingRow.querySelector('.enh-img-strip').setAttribute('data-enh-key', 't4|1');
    await frame();
    out.askedAgainWithResult = reads('/shots/new.svg') === 2;
    answer('/shots/new.svg', { ok: true, dataUri: '${PNG}' });
    await wait(50);
    out.createdImageShows = !!document.querySelector('#tool4 img.enh-img-thumb');

    // React keeps the strip and gives it a new path list (an output image in the result).
    document.querySelector('#tool1 .enh-img-strip').setAttribute('data-enh-imgs', '["/shots/a.png","/shots/out.png"]');
    await frame();
    out.newPathInKeptStrip = reads('/shots/out.png') === 1;

    row('tool3', { file_path: '/shots/huge.png' }, 't3');
    await frame();
    answer('/shots/huge.png', { ok: false, error: 'too-large' });
    await wait(50);
    out.errorText = document.querySelector('#tool3 .enh-img-errtext').textContent;

    // The broom: a folded row keeps mini copies of its thumbnails beside its header.
    document.querySelector('[data-enh-broom]').click(); await frame(); await frame();
    var peek = document.querySelector('#tool1 > .enh-broom-peek');
    out.peekShown = !!peek && getComputedStyle(peek).display !== 'none' && peek.querySelectorAll('img').length === 1;
    out.bodyHidden = getComputedStyle(document.querySelector('#tool1 .enh-img-wrap')).display === 'none';
    out.errorRowNoPeek = !document.querySelector('#tool3 > .enh-broom-peek');
    peek.querySelector('img').click(); await frame();
    out.peekZooms = !!document.querySelector('.enh-img-overlay');
  } catch (e) { out.error = String(e && e.stack || e); }
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`

describe('image preview behaviour in a browser', { skip: !CHROME && 'Chrome is not installed on this machine' }, () => {
  test('thumbnail under the row, zoom and Esc, open in the editor, fresh reads per call, created images, errors in words, and the broom keeps a mini copy', () => {
    const classes = findBroomClasses('.toolSummary_Tt1234{}\n.root_Tt1234{}\n', 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";')
    const result = runInChrome({
      css: IMAGE_CSS + '\n' + broomCss(classes),
      scripts: [EDITOR, IMAGE_SHIM, CLAUDE_CODE_TAKES_API, imageScript(), broomScript(classes)],
      body: '<div id="chat"></div><div class="inputFooterV2_Ff4321"></div>',
      driver: DRIVER,
    })
    assert.deepEqual(result, {
      claudeKeptItsApi: true,
      asked: ['enhImgRead /shots/a.png'],
      loading: true,
      thumb: true,
      zoomOpen: true,
      zoomClosedByEsc: true,
      openSent: { type: 'enhImgOpen', path: '/shots/a.png' },
      sameCallReadOnce: true,
      laterCallReadsAgain: true,
      whileRunning: 'Preview unavailable',
      askedAgainWithResult: true,
      createdImageShows: true,
      newPathInKeptStrip: true,
      errorText: 'Image too large to preview',
      peekShown: true,
      bodyHidden: true,
      errorRowNoPeek: true,
      peekZooms: true,
    })
  })
})
