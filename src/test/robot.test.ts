import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as zlib from 'zlib'
import { describe, test } from 'node:test'

import { Engine } from '../engine/engine.ts'
import { RECIPES } from '../recipes/index.ts'
import { checkClaudeCodeFolder } from '../robot/check.ts'
import { newestFirst, problemsIn, renderCompatTable } from '../robot/table.ts'
import { readZipEntries } from '../robot/zip.ts'
import type { VersionReport } from '../robot/check.ts'
import { makeTempDir } from './tmp.ts'

const tmp = () => makeTempDir('enhancer-robot-test-')
const ALL = RECIPES.map(r => r.id)

/** A zip of `entries`, each stored (method 0) or deflated (method 8), written by hand. */
function zipOf (entries: { name: string; text: string; deflate: boolean }[]) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = Buffer.from(entry.text)
    const body = entry.deflate ? zlib.deflateRawSync(data) : data
    const name = Buffer.from(entry.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += 30 + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** A Claude Code-shaped folder holding the Arabic and quote reply anchors but not the broom's. */
function fakeClaudeCode (css = '.chatContainer_AbC123{}\n.message_AbC123{}\n.userMessage_AbC123{}\n.messageInput_Qq1111{}\n') {
  const dir = path.join(tmp(), 'anthropic.claude-code-9.9.9-test')
  fs.mkdirSync(path.join(dir, 'webview'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }))
  fs.writeFileSync(path.join(dir, 'webview', 'index.css'), css)
  fs.writeFileSync(path.join(dir, 'webview', 'index.js'), 'console.log("webview");\n')
  fs.writeFileSync(path.join(dir, 'extension.js'), 'module.exports = {};\n')
  return dir
}

const report = (version: string, platform: string, overrides: Partial<VersionReport> = {}): VersionReport => ({
  version, platform, checkedAt: '2026-10-18T09:00:00.000Z', safety: 'ok',
  features: { rtl: { state: 'active' }, broom: { state: 'active' }, quoteReply: { state: 'active' }, quoteTools: { state: 'active' }, imagePreview: { state: 'active' } },
  ...overrides,
})

describe('zip reader', () => {
  test('reads stored and deflated entries and leaves the others out', () => {
    const zip = zipOf([
      { name: 'extension/package.json', text: '{"version":"2.1.302"}', deflate: false },
      { name: 'extension/webview/index.css', text: '.a{color:red}\n'.repeat(50), deflate: true },
      { name: 'extension/other.js', text: 'ignored', deflate: true },
    ])
    const entries = readZipEntries(zip, ['extension/package.json', 'extension/webview/index.css', 'extension/missing.js'])
    assert.deepEqual([...entries.keys()], ['extension/package.json', 'extension/webview/index.css'])
    assert.equal(entries.get('extension/package.json')!.toString(), '{"version":"2.1.302"}')
    assert.equal(entries.get('extension/webview/index.css')!.toString(), '.a{color:red}\n'.repeat(50))
  })

  test('refuses an entry compressed in a way it cannot read', () => {
    const zip = zipOf([{ name: 'extension/package.json', text: '{}', deflate: false }])
    zip.writeUInt16LE(12, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10)
    assert.throws(() => readZipEntries(zip, ['extension/package.json']), /unsupported zip compression 12/)
  })

  test('refuses an entry whose size does not match', () => {
    const zip = zipOf([{ name: 'extension/package.json', text: '{"a":1}', deflate: true }])
    zip.writeUInt32LE(99, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24)
    assert.throws(() => readZipEntries(zip, ['extension/package.json']), /has 7 bytes, expected 99/)
  })

  test('refuses a file that is not a zip', () => {
    assert.throws(() => readZipEntries(Buffer.alloc(100), ['x']), /not a zip/)
  })
})

describe('checking one Claude Code release', () => {
  test('a feature whose anchors are missing waits, the others work, and restore is byte-exact', async () => {
    const dir = fakeClaudeCode()
    const result = await checkClaudeCodeFolder(dir, new Engine(tmp(), RECIPES), ALL, 'test-x64')
    assert.equal(result.version, '9.9.9')
    assert.equal(result.safety, 'ok')
    assert.deepEqual(result.features.rtl, { state: 'active' })
    assert.deepEqual(result.features.quoteReply, { state: 'active' })
    assert.deepEqual(result.features.quoteTools, { state: 'active' })
    assert.equal(result.features.broom?.state, 'waiting')
  })

  test('a release where no feature fits is still safe', async () => {
    const result = await checkClaudeCodeFolder(fakeClaudeCode('.nothing{}\n'), new Engine(tmp(), RECIPES), ['rtl'], 'test-x64')
    assert.equal(result.safety, 'ok')
    assert.equal(result.features.rtl?.state, 'waiting')
  })

  test('a restore that leaves the changes in is reported as broken', async () => {
    const engine = new Engine(tmp(), RECIPES)
    const leavesChanges = {
      apply: engine.apply.bind(engine),
      status: engine.status.bind(engine),
      restore: async () => ({ outcome: 'restored' as const, changed: true }),
    }
    const result = await checkClaudeCodeFolder(fakeClaudeCode(), leavesChanges, ALL, 'test-x64')
    assert.equal(result.safety, 'broken')
    assert.match(result.safetyProblem!, /original bytes/)
  })

  test('applying again that changes the files is reported as broken', async () => {
    const engine = new Engine(tmp(), RECIPES)
    let calls = 0
    const changesTwice = {
      apply: async (dir: string, features: readonly (typeof ALL)[number][]) => {
        const result = await engine.apply(dir, features)
        return ++calls === 2 && result.outcome === 'applied' ? { ...result, changed: true } : result
      },
      status: engine.status.bind(engine),
      restore: engine.restore.bind(engine),
    }
    const result = await checkClaudeCodeFolder(fakeClaudeCode(), changesTwice, ALL, 'test-x64')
    assert.equal(result.safety, 'broken')
    assert.match(result.safetyProblem!, /applying again/)
  })

  /** The real engine with one step answered by `override` on its `call`-th use (1-based). */
  function engineWith (step: 'apply' | 'status' | 'restore', call: number, override: (real: () => Promise<any>, dir: string) => Promise<any>) {
    const engine = new Engine(tmp(), RECIPES)
    let calls = 0
    const wrap = (name: typeof step) => async (dir: string, ...rest: any[]) => {
      const real = () => (engine[name] as any).call(engine, dir, ...rest)
      return name === step && ++calls === call ? override(real, dir) : real()
    }
    return { apply: wrap('apply'), status: wrap('status'), restore: wrap('restore') }
  }

  const safetyCases: [string, ReturnType<typeof engineWith>, RegExp][] = [
    ['the original copy is not seen as original', engineWith('status', 1, async real => ({ ...(await real()), files: 'enhanced' })), /not seen as original/],
    ['apply answers that a file is locked', engineWith('apply', 1, async () => ({ outcome: 'locked', file: 'webview/index.css' })), /apply answered/],
    ['applying again writes other bytes while saying nothing changed', engineWith('apply', 2, async (real, dir) => {
      const result = await real()
      fs.appendFileSync(path.join(dir, 'webview', 'index.css'), '/* drift */\n')
      return result
    }), /different bytes/],
    ['after apply the files are seen as original', engineWith('status', 2, async real => ({ ...(await real()), files: 'pristine' })), /after apply/],
    ['after apply the files hold other features than apply reported', engineWith('status', 2, async real => ({ ...(await real()), appliedFeatures: ['rtl'] })), /the files hold/],
    ['restore answers that a file is locked', engineWith('restore', 1, async () => ({ outcome: 'locked', file: 'webview/index.js' })), /restore answered/],
    ['after restore the files are not seen as original', engineWith('status', 3, async real => ({ ...(await real()), files: 'modified-elsewhere' })), /after restore/],
  ]
  for (const [what, engine, problem] of safetyCases) {
    test(`broken when ${what}`, async () => {
      const result = await checkClaudeCodeFolder(fakeClaudeCode(), engine, ALL, 'test-x64')
      assert.equal(result.safety, 'broken')
      assert.match(result.safetyProblem!, problem)
    })
  }

  test('a healthy release reports every step safe with the version and system', async () => {
    const result = await checkClaudeCodeFolder(fakeClaudeCode(), new Engine(tmp(), RECIPES), ALL, 'test-x64')
    assert.deepEqual({ version: result.version, platform: result.platform, safety: result.safety, problem: result.safetyProblem },
      { version: '9.9.9', platform: 'test-x64', safety: 'ok', problem: undefined })
  })

  test('a folder already holding injected changes is reported as broken', async () => {
    const result = await checkClaudeCodeFolder(fakeClaudeCode('.message_AbC123{}\n/* RTL Support BEGIN */\n.x{}\n/* RTL Support END */\n'), new Engine(tmp(), RECIPES), ALL, 'test-x64')
    assert.equal(result.safety, 'broken')
    assert.match(result.safetyProblem!, /not seen as original/)
  })
})

describe('compatibility table and problems', () => {
  test('versions sort newest first by number, not by text', () => {
    assert.deepEqual(['2.1.30', '2.1.302', '2.1.299', '2.2.0'].sort(newestFirst), ['2.2.0', '2.1.302', '2.1.299', '2.1.30'])
  })

  test('the table lists each release and system, newest first, with each feature state', () => {
    const table = renderCompatTable({
      'darwin-arm64': {
        '2.1.301': report('2.1.301', 'darwin-arm64'),
        '2.1.302': report('2.1.302', 'darwin-arm64', { features: { rtl: { state: 'active' }, broom: { state: 'waiting', reason: 'no toolSummary class' }, quoteReply: { state: 'active' }, quoteTools: { state: 'active' }, imagePreview: { state: 'active' } } }),
      },
      'win32-x64': { '2.1.302': report('2.1.302', 'win32-x64', { safety: 'broken', safetyProblem: 'restore did not give back the original bytes' }) },
    })
    const rows = table.split('\n').filter(line => /^\| \d/.test(line))
    assert.deepEqual(rows, [
      '| 2.1.302 | darwin-arm64 | ✅ works | ⏳ waiting for an update | ✅ works | ✅ works | ✅ works | ✅ | 2026-10-18 |',
      '| 2.1.302 | win32-x64 | — | — | — | — | — | ❌ restore did not give back the original bytes | 2026-10-18 |',
      '| 2.1.301 | darwin-arm64 | ✅ works | ✅ works | ✅ works | ✅ works | ✅ works | ✅ | 2026-10-18 |',
    ])
  })

  test('problems name the waiting features and a broken safety, and nothing when all works', () => {
    assert.deepEqual(problemsIn(report('2.1.302', 'darwin-arm64')), [])
    assert.deepEqual(
      problemsIn(report('2.1.302', 'darwin-arm64', { features: { rtl: { state: 'waiting', reason: 'no message class' }, broom: { state: 'active' } } })),
      ['2.1.302 (darwin-arm64): Arabic RTL waiting: no message class'],
    )
    assert.deepEqual(
      problemsIn(report('2.1.302', 'win32-x64', { safety: 'broken', safetyProblem: 'apply answered locked' })),
      ['2.1.302 (win32-x64): safety broken: apply answered locked'],
    )
  })
})
