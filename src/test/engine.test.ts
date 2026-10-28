import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import { io } from '../engine/files.ts'
import { RECIPES } from '../recipes/index.ts'
import { RTL_CSS_BEGIN, RTL_JS_BEGIN, findRtlClasses, rtlRecipe } from '../recipes/rtl.ts'
import type { Recipe } from '../engine/recipe.ts'
import { makeTempDir } from './tmp.ts'

const realRename = io.rename
afterEach(() => { io.rename = realRename })

const tmp = () => makeTempDir('enhancer-test-')

const CSS = [
  '.chatContainer_AbC123{line-height:1.5}',
  '.message_AbC123{padding:0}',
  '.message_Zz9999{color:red}',
  '.userMessage_AbC123{margin:0}',
  '.messageInput_Qq1111{color:inherit}',
  '',
].join('\n')
const JS = 'console.log("webview");\n'
const EXT = 'module.exports = {};\n'

/** A fake Claude Code folder: <root>/anthropic.claude-code-<version>-test with its three target files. */
function fakeClaudeCode (version: string, css = CSS, js = JS) {
  const dir = path.join(tmp(), `anthropic.claude-code-${version}-test`)
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(dir, 'webview', 'index.css'), css)
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), js)
  fs.writeFileSync(path.join(dir, 'extension.js'), EXT)
  return dir
}

/** The files state from status(); fails the test if the engine answered busy or locked. */
async function filesOf (engine: Engine, dir: string) {
  const status = await engine.status(dir)
  assert.ok('files' in status, `status answered ${JSON.stringify(status)}`)
  return status.files
}

const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, ...file.split('/')))
const snapshot = (dir: string) => ({
  css: read(dir, 'webview/index.css'),
  js: read(dir, 'webview/index.js'),
  ext: read(dir, 'extension.js'),
})

describe('safe restore', () => {
  test('restore after apply gives back the exact original bytes', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)

    const applied = await engine.apply(dir, ['rtl'])
    assert.equal(applied.outcome, 'applied')
    assert.notDeepEqual(snapshot(dir), before)

    assert.deepEqual(await engine.restore(dir), { outcome: 'restored', changed: true })
    assert.deepEqual(snapshot(dir), before)
  })

  test('applying twice changes nothing the second time', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const engine = new Engine(tmp(), RECIPES)
    await engine.apply(dir, ['rtl'])
    const once = snapshot(dir)
    const again = await engine.apply(dir, ['rtl'])
    assert.equal(again.outcome, 'applied')
    assert.equal(again.outcome === 'applied' && again.changed, false)
    assert.deepEqual(snapshot(dir), once)
  })

  test('a file already changed by the old injector is refused and no original copy is saved', async () => {
    const dir = fakeClaudeCode('2.1.301', `${CSS}\n/* RTL Support BEGIN */\n.x{}\n/* RTL Support END */\n`)
    const before = snapshot(dir)
    const storage = tmp()
    const result = await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    assert.equal(result.outcome, 'modified-elsewhere')
    assert.deepEqual(snapshot(dir), before)
    assert.equal(fs.existsSync(path.join(storage, 'baselines')), false)
  })

  test('a Claude Code version Enhancer never saw is tried, and a feature that fits applies', async () => {
    const dir = fakeClaudeCode('9.9.9')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    assert.deepEqual(await engine.apply(dir, ['rtl']), { outcome: 'applied', changed: true, features: [{ id: 'rtl', outcome: 'applied' }] })
    assert.ok(read(dir, 'webview/index.css').toString('utf8').includes(RTL_CSS_BEGIN))
    assert.equal(await filesOf(engine, dir), 'enhanced')
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })

  test('on a Claude Code version Enhancer never saw, a feature that does not fit fails alone and leaves the files original', async () => {
    const dir = fakeClaudeCode('9.9.9', '.message_AbC123{}\n.userMessage_AbC123{}\n')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    const result = await engine.apply(dir, ['rtl'])
    assert.equal(result.outcome, 'applied')
    assert.equal(result.outcome === 'applied' && result.changed, false)
    assert.equal(result.outcome === 'applied' && result.features[0].outcome, 'failed')
    assert.deepEqual(snapshot(dir), before)
  })

  test('an apply interrupted mid-commit is recovered to the original bytes on the next start', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const storage = tmp()
    await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    // The state a crash leaves: one file half-written, the journal still there.
    fs.writeFileSync(path.join(dir, 'webview', 'index.css'), '.chatContainer_AbC123{line-he')
    fs.writeFileSync(path.join(storage, 'journal.json'), JSON.stringify({ extensionDir: dir, files: ['webview/index.css', 'webview/index.js'] }))

    assert.equal(await filesOf(new Engine(storage, RECIPES), dir), 'pristine')
    assert.deepEqual(snapshot(dir), before)
    assert.equal(fs.existsSync(path.join(storage, 'journal.json')), false)
  })

  test('a file that stays locked (Windows) leaves everything original and reports it', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const storage = tmp()
    const lockedFile = path.join(dir, 'webview', 'index.js')
    io.rename = async (from, to) => {
      if (to === lockedFile) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return realRename(from, to)
    }
    const result = await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    assert.equal(result.outcome, 'locked')
    io.rename = realRename
    assert.deepEqual(snapshot(dir), before)
    assert.equal(fs.existsSync(path.join(storage, 'journal.json')), false)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'webview')).sort(), ['index.css', 'index.js'])
  })

  test('a change made by someone else after Enhancer is refused, and restore still brings the original back', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    await engine.apply(dir, ['rtl'])
    fs.appendFileSync(path.join(dir, 'webview', 'index.css'), '.someone-else{}\n')
    const foreign = snapshot(dir)

    assert.equal((await engine.apply(dir, ['rtl'])).outcome, 'modified-elsewhere')
    assert.deepEqual(snapshot(dir), foreign)
    assert.equal((await engine.restore(dir)).outcome, 'restored')
    assert.deepEqual(snapshot(dir), before)
  })

  test('Windows line endings are kept: the added block uses CRLF and restore is exact', async () => {
    const crlfCss = CSS.replace(/\n/g, '\r\n')
    const dir = fakeClaudeCode('2.1.301', crlfCss, JS.replace(/\n/g, '\r\n'))
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)
    await engine.apply(dir, ['rtl'])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.startsWith(crlfCss))
    assert.equal(/[^\r]\n/.test(css), false, 'no bare LF in a CRLF file')
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
})

describe('review round 1', () => {
  test('a newer Enhancer whose Arabic block changed recognises the old output as its own and updates it', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    const newer: Recipe = {
      ...rtlRecipe,
      apply: texts => {
        const out = rtlRecipe.apply(texts)
        return { ...out, 'webview/index.css': `${out['webview/index.css']}/* v2 */\n` }
      },
    }
    const result = await new Engine(storage, [newer]).apply(dir, ['rtl'])
    assert.equal(result.outcome, 'applied')
    assert.equal(result.outcome === 'applied' && result.changed, true)
    assert.ok(read(dir, 'webview/index.css').toString('utf8').endsWith('/* v2 */\n'))
  })

  test('two editor windows applying at the same moment end with one clean result', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    const results = await Promise.all([new Engine(storage, RECIPES).apply(dir, ['rtl']), new Engine(storage, RECIPES).apply(dir, ['rtl'])])
    assert.deepEqual(results.map(r => r.outcome), ['applied', 'applied'])
    const reference = fakeClaudeCode('2.1.301')
    await new Engine(tmp(), RECIPES).apply(reference, ['rtl'])
    assert.deepEqual(snapshot(dir), snapshot(reference))
    assert.deepEqual(fs.readdirSync(storage).sort(), ['baselines'])
  })

  test('a lock left by a process that died long ago does not block Enhancer', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    fs.writeFileSync(path.join(storage, 'lock'), '999999')
    const old = new Date(Date.now() - 5 * 60_000)
    fs.utimesSync(path.join(storage, 'lock'), old, old)
    assert.equal((await new Engine(storage, RECIPES).apply(dir, ['rtl'])).outcome, 'applied')
  })

  test('uninstall restores every Claude Code folder Enhancer changed', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const storage = tmp()
    await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    const results = await new Engine(storage, RECIPES).restoreAll()
    assert.deepEqual(results, [{ extensionDir: dir, result: { outcome: 'restored', changed: true } }])
    assert.deepEqual(snapshot(dir), before)
  })

  test('a crash after the journal but before the rename leaves no staged file behind', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const storage = tmp()
    await new Engine(storage, RECIPES).restore(dir)
    await new Engine(storage, RECIPES).apply(dir, [])
    fs.writeFileSync(path.join(storage, 'journal.json'), JSON.stringify({ extensionDir: dir, files: ['webview/index.css'] }))
    fs.writeFileSync(path.join(dir, 'webview', 'index.css.enhancer-staged'), 'half')
    await new Engine(storage, RECIPES).recover()
    assert.deepEqual(fs.readdirSync(path.join(dir, 'webview')).sort(), ['index.css', 'index.js'])
    assert.deepEqual(snapshot(dir), before)
  })

  test('a journal pointing at a Claude Code folder that no longer exists is dropped without recreating it', async () => {
    const storage = tmp()
    const gone = path.join(tmp(), 'anthropic.claude-code-2.1.300-test')
    fs.writeFileSync(path.join(storage, 'journal.json'), JSON.stringify({ extensionDir: gone, files: ['webview/index.css'] }))
    await new Engine(storage, RECIPES).recover()
    assert.equal(fs.existsSync(gone), false)
    assert.equal(fs.existsSync(path.join(storage, 'journal.json')), false)
  })

  test('a journal that cannot be recovered (no original copy) is kept as journal.failed.json', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    fs.writeFileSync(path.join(storage, 'journal.json'), JSON.stringify({ extensionDir: dir, files: ['webview/index.css'] }))
    await new Engine(storage, RECIPES).recover()
    assert.equal(fs.existsSync(path.join(storage, 'journal.failed.json')), true)
  })
})

describe('review round 2', () => {
  const cssOnlyUpdate: Recipe = {
    ...rtlRecipe,
    apply: texts => {
      const out = rtlRecipe.apply(texts)
      return { ...out, 'webview/index.css': `${out['webview/index.css']}/* v2 */\n` }
    },
  }

  test('an update that touches one file and fails on a lock is still recognised as ours afterwards', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    const css = path.join(dir, 'webview', 'index.css')
    io.rename = async (from, to) => {
      if (to === css) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return realRename(from, to)
    }
    assert.equal((await new Engine(storage, [cssOnlyUpdate]).apply(dir, ['rtl'])).outcome, 'locked')
    io.rename = realRename
    assert.notEqual(await filesOf(new Engine(storage, [cssOnlyUpdate]), dir), 'modified-elsewhere')
    const retry = await new Engine(storage, [cssOnlyUpdate]).apply(dir, ['rtl'])
    assert.equal(retry.outcome, 'applied')
    assert.ok(read(dir, 'webview/index.css').toString('utf8').endsWith('/* v2 */\n'))
  })

  test('the lock of a process that no longer exists is taken over at once', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    fs.writeFileSync(path.join(storage, 'lock'), '2147483646:gone')
    const started = Date.now()
    assert.equal((await new Engine(storage, RECIPES).apply(dir, ['rtl'])).outcome, 'applied')
    assert.ok(Date.now() - started < 5_000)
    assert.equal(fs.existsSync(path.join(storage, 'lock')), false)
  })

  test('a lock that another process took over meanwhile is not deleted when ours ends', async () => {
    const storage = tmp()
    const engine = new Engine(storage, RECIPES)
    const lockFile = path.join(storage, 'lock')
    const locked = (engine as unknown as { locked: (work: () => Promise<void>) => Promise<void> }).locked
    await locked.call(engine, async () => {
      // While we hold it, another process replaces the lock (a stale takeover).
      fs.writeFileSync(lockFile, `${process.pid}:someone-else`)
    })
    assert.equal(fs.readFileSync(lockFile, 'utf8'), `${process.pid}:someone-else`)
  })

  test('uninstall skips an editor where Enhancer is still installed, and a folder changed by another tool', async () => {
    const storage = tmp()
    const withEnhancer = fakeClaudeCode('2.1.301')
    fs.mkdirSync(path.join(path.dirname(withEnhancer), 'enhancer.enhancer-for-claude-code-0.1.0'))
    const foreign = fakeClaudeCode('2.1.301')
    const engine = new Engine(storage, RECIPES)
    await engine.apply(withEnhancer, ['rtl'])
    await engine.apply(foreign, ['rtl'])
    fs.appendFileSync(path.join(foreign, 'webview', 'index.css'), '.someone-else{}\n')
    const enhanced = snapshot(withEnhancer)
    const changed = snapshot(foreign)
    assert.deepEqual(await engine.restoreAll(), [])
    assert.deepEqual(snapshot(withEnhancer), enhanced)
    assert.deepEqual(snapshot(foreign), changed)
  })

  test('an install from before the write record existed is still recognised as ours', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const storage = tmp()
    await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    fs.rmSync(path.join(storage, 'baselines', path.basename(dir), 'written.json'))
    assert.equal(await filesOf(new Engine(storage, RECIPES), dir), 'enhanced')
  })
})

describe('locked files', () => {
  test('a locked storage folder while saving the original copy is reported as locked, not thrown', async () => {
    const dir = fakeClaudeCode('2.1.301')
    const before = snapshot(dir)
    const storage = tmp()
    io.rename = async (from, to) => {
      if (to.startsWith(storage)) throw Object.assign(new Error('busy'), { code: 'EPERM' })
      return realRename(from, to)
    }
    const result = await new Engine(storage, RECIPES).apply(dir, ['rtl'])
    assert.equal(result.outcome, 'locked')
    io.rename = realRename
    assert.deepEqual(snapshot(dir), before)
  })
})

describe('Arabic recipe anchors', () => {
  test('a version without the chat container class fails the recipe and changes nothing', async () => {
    const dir = fakeClaudeCode('2.1.301', '.message_AbC123{}\n.userMessage_AbC123{}\n')
    const before = snapshot(dir)
    const result = await new Engine(tmp(), RECIPES).apply(dir, ['rtl'])
    assert.equal(result.outcome, 'applied')
    if (result.outcome !== 'applied') return
    assert.equal(result.changed, false)
    assert.equal(result.features[0].outcome, 'failed')
    assert.deepEqual(snapshot(dir), before)
  })

  test('two different chat container classes are ambiguous and fail instead of guessing', () => {
    assert.throws(() => findRtlClasses(`${CSS}.chatContainer_Other1{}\n`), /chatContainer: 2 classes/)
  })

  test('the message class is the one sharing the chat container hash, not the first alphabetically', () => {
    const classes = findRtlClasses(CSS)
    assert.equal(classes.message, 'message_AbC123')
    assert.equal(classes.userMessage, 'userMessage_AbC123')
    assert.equal(classes.messageInput, 'messageInput_Qq1111')
  })

  test('the files get the Arabic style block and the Arabic script block', async () => {
    const dir = fakeClaudeCode('2.1.301')
    await new Engine(tmp(), RECIPES).apply(dir, ['rtl'])
    const css = read(dir, 'webview/index.css').toString('utf8')
    const js = read(dir, 'webview/index.js').toString('utf8')
    assert.ok(css.includes(RTL_CSS_BEGIN))
    assert.ok(css.includes('.message_AbC123 [data-cc-dir="rtl"]'))
    assert.ok(js.includes(RTL_JS_BEGIN))
    assert.ok(js.includes('"message_AbC123"'))
    assert.equal(read(dir, 'extension.js').toString('utf8'), EXT)
  })

  test('the injected script turns every right-to-left language right to left, and leaves the others alone', async () => {
    const dir = fakeClaudeCode('2.1.301')
    await new Engine(tmp(), RECIPES).apply(dir, ['rtl'])
    const js = read(dir, 'webview/index.js').toString('utf8')
    const found = js.match(/var RTL_LETTER = new RegExp\(("(?:[^"\\]|\\.)*"), 'u'\);/)
    assert.ok(found, 'the script declares RTL_LETTER')
    const rtlLetter = new RegExp(JSON.parse(found[1]), 'u')
    for (const text of ['Fix the bug في الملف', 'سلام دنیا', 'یہ اردو ہے', 'שלום עולם', 'ܫܠܡܐ', 'ހެލޯ', 'ﻻ', 'Fix \u{1E900}\u{1E922}', 'Fix \u{10D00}\u{10D01}'])
      assert.ok(rtlLetter.test(text), `right to left: ${text}`)
    // Signs, punctuation, digits and lone marks of those scripts are not letters: no turn.
    for (const text of ['Hello world', 'Привет', '你好世界', 'Ελληνικά', '\uFEFFHello', 'Sum: 1 \uFB29 2 = 3', 'a\u07F8b', 'x\u05B0', 'Total ١٢٣'])
      assert.equal(rtlLetter.test(text), false, `left to right: ${text}`)
  })
})

// The pristine copies the owner's prototype saved, when present on this machine.
const PROTOTYPE_BASELINES = path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeInjector', 'baselines')
for (const version of ['2.1.296', '2.1.300', '2.1.301']) {
  const source = path.join(PROTOTYPE_BASELINES, `anthropic.claude-code-${version}-darwin-arm64`)
  test(`real Claude Code ${version}: apply works and restore is byte-exact`, { skip: !fs.existsSync(source) && 'no pristine copy on this machine' }, async () => {
    const dir = path.join(tmp(), path.basename(source))
    fs.cpSync(source, dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    const before = snapshot(dir)
    const engine = new Engine(tmp(), RECIPES)

    const result = await engine.apply(dir, ['rtl'])
    assert.equal(result.outcome, 'applied')
    assert.deepEqual(result.outcome === 'applied' && result.features, [{ id: 'rtl', outcome: 'applied' }])
    const css = read(dir, 'webview/index.css').toString('utf8')
    assert.ok(css.includes('.message_07S1Yg [data-cc-dir="rtl"]'))

    assert.equal(await filesOf(engine, dir), 'enhanced')
    await engine.restore(dir)
    assert.deepEqual(snapshot(dir), before)
  })
}
