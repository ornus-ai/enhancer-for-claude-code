// Languages: every translation is complete and safe to fill, the editor's settings are
// translated for every language, the right language is chosen, and the chosen language
// reaches the chat's labels and the control panel.
import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import { allRecipeOptions, outsideLanguage, recipeOptionsFrom } from '../features.ts'
import { LANGUAGES, en, fill, resolveLanguage, textFor } from '../i18n/index.ts'
import type { LanguageId } from '../i18n/index.ts'
import { parsePanelMessage } from '../panel/messages.ts'
import { panelMeta, panelState } from '../panel/state.ts'
import type { PanelInput } from '../panel/state.ts'
import { RECIPES } from '../recipes/index.ts'
import { quoteToolsScript } from '../recipes/quoteTools.ts'
import { CHROME, runInChrome } from './chrome.ts'
import { makeTempDir } from './tmp.ts'

const ROOT = process.cwd()
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
const placeholders = (text: string) => [...text.matchAll(/\{\d\}/g)].map(m => m[0]).sort()

describe('translations', () => {
  test('English comes first; every other language follows once, each with its own texts', () => {
    assert.deepEqual(LANGUAGES.map(l => l.id), ['en', 'zh-cn', 'hi', 'es', 'ar', 'fr', 'bn', 'pt-br', 'ru', 'id', 'ur', 'de', 'ja', 'vi', 'tr', 'ko', 'fa', 'it', 'pl', 'uk', 'he'])
    assert.deepEqual(LANGUAGES.filter(l => l.dir === 'rtl').map(l => l.id), ['ar', 'ur', 'fa', 'he'])
    for (const l of LANGUAGES.slice(1)) assert.notEqual(l.text.c_copy, en.c_copy, `${l.id} still has the English "Copy"`)
  })

  for (const { id, text } of LANGUAGES) {
    test(`${id}: every text is there, filled in, with the same {n} places as English and the product names kept`, () => {
      assert.deepEqual(Object.keys(text).sort(), Object.keys(en).sort())
      for (const [key, value] of Object.entries(text)) {
        assert.ok(value.trim().length > 0, `${id}.${key} is empty`)
        assert.deepEqual(placeholders(value), placeholders(en[key as keyof typeof en]), `${id}.${key} changed its {n} places`)
      }
      assert.equal(text.title, 'Enhancer for Claude Code')
      assert.equal(text.builtWith, 'Built with Ornus')
      assert.ok(text.s_active.includes('Claude Code'), `${id}.s_active lost the name Claude Code`)
    })
  }

  test('the editor settings: every %key% in package.json has an English text, and each language translates all of them', () => {
    const base = readJson('package.nls.json')
    const refs = [...JSON.stringify(readJson('package.json')).matchAll(/"%([^%"]+)%"/g)].map(m => m[1])
    assert.deepEqual([...new Set(refs)].sort(), Object.keys(base).sort(), 'package.json and package.nls.json name the same texts')
    for (const { id } of LANGUAGES.slice(1)) {
      const nls = readJson(`package.nls.${id}.json`)
      assert.deepEqual(Object.keys(nls).sort(), Object.keys(base).sort(), `package.nls.${id}.json keys`)
      for (const [key, value] of Object.entries(nls)) assert.ok(typeof value === 'string' && value.trim(), `package.nls.${id}.json "${key}" is empty`)
      assert.match(nls['view.welcome'], /^\[[^\]]+\]\(command:enhancer\.openPanel\)$/, `package.nls.${id}.json keeps the panel link`)
    }
  })

  test('the language setting offers Automatic and exactly these languages, named in themselves', () => {
    const setting = readJson('package.json').contributes.configuration.properties['enhancer.language']
    assert.equal(setting.default, 'auto')
    assert.deepEqual(setting.enum, ['auto', ...LANGUAGES.map(l => l.id)])
    assert.deepEqual(setting.enumItemLabels.slice(1), LANGUAGES.map(l => l.name))
    assert.equal(readJson('package.json').contributes.configuration.properties['enhancer.languageEverywhere'].default, true)
  })

  test('fill puts the values in their places', () => {
    assert.equal(fill(en.s_partial, 4, 5), '4 of 5 enhancements active')
    assert.equal(fill(textFor('ar').s_partial, 4, 5), '4 من 5 تحسينات تعمل')
  })
})

describe('choosing the language', () => {
  test('Automatic follows the editor: exact, regional variants, Chinese; English when Enhancer does not speak it', () => {
    const cases: [string, LanguageId][] = [
      ['en', 'en'], ['en-gb', 'en'], ['ar', 'ar'], ['fa', 'fa'], ['he', 'he'], ['tr', 'tr'], ['es', 'es'], ['zh-cn', 'zh-cn'],
      ['zh-tw', 'zh-cn'], ['pt-br', 'pt-br'], ['pt', 'pt-br'], ['de', 'de'], ['ja', 'ja'], ['ko', 'ko'], ['uk', 'uk'],
      ['cs', 'en'], ['hu', 'en'], ['', 'en'], ['ZH-CN', 'zh-cn'],
    ]
    for (const [editor, expected] of cases) assert.equal(resolveLanguage('auto', editor), expected, `editor "${editor}"`)
  })

  test("the user's choice wins over the editor; an unknown value counts as Automatic", () => {
    assert.equal(resolveLanguage('tr', 'ar'), 'tr')
    assert.equal(resolveLanguage('en', 'ar'), 'en')
    assert.equal(resolveLanguage('klingon', 'ar'), 'ar')
    assert.equal(resolveLanguage(undefined, 'he'), 'he')
  })

  test('the chat and messages use the panel language unless the user keeps them in English', () => {
    assert.equal(outsideLanguage('fa', true), 'fa')
    assert.equal(outsideLanguage('fa', undefined), 'fa')
    assert.equal(outsideLanguage('fa', false), 'en')
  })

  test('the panel accepts a known language or Automatic, nothing else', () => {
    assert.deepEqual(parsePanelMessage({ type: 'setLanguage', language: 'he' }), { type: 'setLanguage', language: 'he' })
    assert.deepEqual(parsePanelMessage({ type: 'setLanguage', language: 'auto' }), { type: 'setLanguage', language: 'auto' })
    assert.equal(parsePanelMessage({ type: 'setLanguage', language: 'xx' }), undefined)
    assert.equal(parsePanelMessage({ type: 'setLanguage', language: 3 }), undefined)
    assert.deepEqual(parsePanelMessage({ type: 'setInterface', setting: 'languageEverywhere', on: false }), { type: 'setInterface', setting: 'languageEverywhere', on: false })
  })
})

describe('the chosen language reaches the chat', () => {
  test('applying with Turkish writes Turkish labels into the chat scripts; switching back to English rewrites them', async () => {
    const dir = path.join(makeTempDir('enhancer-i18n-'), 'anthropic.claude-code-2.1.301-test')
    fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.1.301' }))
    fs.writeFileSync(path.join(dir, 'webview', 'index.css'), '.toolSummary_Tt1234{display:flex}\n.root_Tt1234{position:relative}\n')
    fs.writeFileSync(path.join(dir, 'webview', 'index.js'), 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";\n')
    fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
    let lang: LanguageId = 'tr'
    const engine = new Engine(makeTempDir('enhancer-i18n-state-'), RECIPES, () => recipeOptionsFrom(() => undefined, textFor(lang)))
    await engine.apply(dir, ['broom', 'quoteTools'])
    const js = () => fs.readFileSync(path.join(dir, 'webview', 'index.js'), 'utf8')
    for (const label of [textFor('tr').c_showDetails, textFor('tr').c_selectQuote]) assert.ok(js().includes(JSON.stringify(label).slice(1, -1)), `missing "${label}"`)
    lang = 'en'
    const back = await engine.apply(dir, ['broom', 'quoteTools'])
    assert.equal(back.outcome === 'applied' && back.changed, true)
    assert.ok(js().includes('"Show details"') && !js().includes(textFor('tr').c_showDetails))
  })

  test('without the record of what was written, a language changed since the last apply still reads as Enhancer\'s own files; another tool\'s change does not', async () => {
    const dir = path.join(makeTempDir('enhancer-i18n-'), 'anthropic.claude-code-2.1.301-test')
    fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.1.301' }))
    fs.writeFileSync(path.join(dir, 'webview', 'index.css'), '.toolSummary_Tt1234{display:flex}\n.root_Tt1234{position:relative}\n')
    fs.writeFileSync(path.join(dir, 'webview', 'index.js'), 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";\n')
    fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
    const storage = makeTempDir('enhancer-i18n-state-')
    let lang: LanguageId = 'tr'
    const engine = () => new Engine(storage, RECIPES, () => recipeOptionsFrom(() => undefined, textFor(lang)), allRecipeOptions)
    await engine().apply(dir, ['broom', 'quoteTools'])
    const dropRecord = () => {
      for (const name of fs.readdirSync(path.join(storage, 'baselines'))) fs.rmSync(path.join(storage, 'baselines', name, 'written.json'), { force: true })
    }
    dropRecord()
    lang = 'en'
    const status = await engine().status(dir)
    assert.equal('files' in status && status.files, 'enhanced')
    const reapplied = await engine().apply(dir, ['broom', 'quoteTools'])
    assert.equal(reapplied.outcome, 'applied')

    dropRecord()
    fs.appendFileSync(path.join(dir, 'webview', 'index.js'), '/* another tool */\n')
    const foreign = await engine().status(dir)
    assert.equal('files' in foreign && foreign.files, 'modified-elsewhere')
  })

  test('without the record, an engine given no other option sets still recognises files written with its current options', async () => {
    const dir = path.join(makeTempDir('enhancer-i18n-'), 'anthropic.claude-code-2.1.301-test')
    fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.1.301' }))
    fs.writeFileSync(path.join(dir, 'webview', 'index.css'), '.toolSummary_Tt1234{display:flex}\n.root_Tt1234{position:relative}\n')
    fs.writeFileSync(path.join(dir, 'webview', 'index.js'), 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";\n')
    fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
    const storage = makeTempDir('enhancer-i18n-state-')
    await new Engine(storage, RECIPES).apply(dir, ['broom'])
    for (const name of fs.readdirSync(path.join(storage, 'baselines'))) fs.rmSync(path.join(storage, 'baselines', name, 'written.json'))
    const status = await new Engine(storage, RECIPES).status(dir)
    assert.equal('files' in status && status.files, 'enhanced')
  })

  test('without the record, the slow check over every option set runs once for the same files, not on every status read', async () => {
    const dir = path.join(makeTempDir('enhancer-i18n-'), 'anthropic.claude-code-2.1.301-test')
    fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.1.301' }))
    fs.writeFileSync(path.join(dir, 'webview', 'index.css'), '.toolSummary_Tt1234{display:flex}\n.root_Tt1234{position:relative}\n')
    fs.writeFileSync(path.join(dir, 'webview', 'index.js'), 'var a="footerButton_Ff4321",b="inputFooterV2_Ff4321";\n')
    fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
    const storage = makeTempDir('enhancer-i18n-state-')
    await new Engine(storage, RECIPES).apply(dir, ['broom'])
    for (const name of fs.readdirSync(path.join(storage, 'baselines'))) fs.rmSync(path.join(storage, 'baselines', name, 'written.json'))
    // Another tool's change: no option set matches, so every read would redo the whole check.
    fs.appendFileSync(path.join(dir, 'webview', 'index.js'), '/* another tool */\n')
    let checks = 0
    const engine = new Engine(storage, RECIPES, undefined, () => { checks++; return allRecipeOptions() })
    for (let i = 0; i < 3; i++) {
      const status = await engine.status(dir)
      assert.equal('files' in status && status.files, 'modified-elsewhere')
    }
    assert.equal(checks, 1)
    fs.appendFileSync(path.join(dir, 'webview', 'index.js'), '/* changed again */\n')
    await engine.status(dir)
    assert.equal(checks, 2)
  })

  test('in a page, the quote buttons read in Arabic, and their names too', { skip: !CHROME && 'Chrome is not installed on this machine' }, () => {
    const driver = `
(async function () {
  var out = {};
  await new Promise(function (r) { setTimeout(r, 300); });
  out.buttons = [].map.call(document.querySelectorAll('#q .enh-qt-btn'), function (b) { return [b.textContent, b.getAttribute('aria-label')]; });
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`
    const result = runInChrome({ css: '', scripts: [quoteToolsScript(textFor('ar'))], body: '<blockquote id="q"><p>سطر</p></blockquote>', driver })
    assert.deepEqual(result.buttons, [['نسخ', 'نسخ الاقتباس'], ['تحديد', 'تحديد الاقتباس']])
  })
})

describe('the control panel in a chosen language', { skip: !CHROME && 'Chrome is not installed on this machine' }, () => {
  test('in Persian: right to left, Persian texts, every language listed in itself; the list keeps the focus when the panel redraws; choosing one posts it', () => {
    const input: PanelInput = {
      turnedOn: true, featureSetting: () => undefined, reapplyAfterUpdate: true, checkForUpdates: true, ornusNews: true,
      feedbackButton: true, feedbackDetails: { extension: '0.1.0', claudeCode: '2.1.301', editor: 'Visual Studio Code 1.105.0', os: 'darwin arm64' },
  feedbackAnswers: [],
      claudeCode: { status: { version: '2.1.301', baseline: 'ok', files: 'enhanced', appliedFeatures: ['rtl', 'broom', 'quoteReply', 'quoteTools', 'imagePreview'] } },
      lastResult: undefined, syncing: false, reloadPending: false, updateAvailable: undefined, news: undefined, justVerified: false,
      language: { setting: 'fa', everywhere: false },
    }
    const css = fs.readFileSync(path.join(ROOT, 'media', 'panel.css'), 'utf8')
    const script = fs.readFileSync(path.join(ROOT, 'media', 'panel.js'), 'utf8')
    const result = runInChrome({
      css,
      scripts: [`window.__sent = []; window.acquireVsCodeApi = function () { return { postMessage: function (m) { window.__sent.push(m); } }; };`, script],
      body: '<div id="app"></div>',
      driver: `
(async function () {
  var out = {};
  window.postMessage({ type: 'state', state: ${JSON.stringify(panelState(input))}, meta: ${JSON.stringify(panelMeta('0.3.0', 'fa'))} }, '*');
  await new Promise(function (r) { setTimeout(r, 50); });
  var select = document.getElementById('language-select');
  out.dir = document.documentElement.dir;
  out.lang = document.documentElement.lang;
  out.section = document.querySelector('#section-interface .section-t').textContent;
  out.value = select.value;
  out.options = [].map.call(select.options, function (o) { return o.textContent; });
  out.everywhere = document.querySelector('#row-language-everywhere [role=switch]').getAttribute('aria-checked');
  select.focus();
  window.postMessage({ type: 'state', state: ${JSON.stringify(panelState(input))}, meta: ${JSON.stringify(panelMeta('0.3.0', 'fa'))} }, '*');
  await new Promise(function (r) { setTimeout(r, 50); });
  out.focusAfterRedraw = document.activeElement && document.activeElement.id;
  select = document.getElementById('language-select');
  select.value = 'he';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  out.sent = window.__sent;
  document.body.setAttribute('data-result', JSON.stringify(out));
})();`,
    })
    assert.equal(result.dir, 'rtl')
    assert.equal(result.lang, 'fa')
    assert.equal(result.section, textFor('fa').interface)
    assert.equal(result.value, 'fa')
    assert.deepEqual(result.options, [textFor('fa').langAuto, ...LANGUAGES.map(l => l.name)])
    assert.equal(result.everywhere, 'false')
    assert.equal(result.focusAfterRedraw, 'language-select')
    assert.deepEqual(result.sent, [{ type: 'ready' }, { type: 'setLanguage', language: 'he' }])
  })
})
