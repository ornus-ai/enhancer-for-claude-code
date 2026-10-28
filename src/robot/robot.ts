#!/usr/bin/env node
// The maintenance robot (PLAN.md §3): checks each new Claude Code release from Open VSX
// on this machine's system and keeps the compatibility table in `compat/`.
//   node out/robot/robot.js check [--latest <n>] [--version <x.y.z>] [--recheck] [--compat <folder>]
//   node out/robot/robot.js table [--compat <folder>]
// `check` exits 1 when a checked release breaks the engine or leaves a feature waiting,
// 2 when the robot itself could not run (network, a damaged download).
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { Engine } from '../engine/engine.ts'
import { TARGET_FILES } from '../engine/recipe.ts'
import { RECIPES } from '../recipes/index.ts'
import { checkClaudeCodeFolder } from './check.ts'
import { newestFirst, problemsIn, renderCompatTable } from './table.ts'
import { readZipEntries } from './zip.ts'
import type { FeatureId } from '../engine/recipe.ts'
import type { PlatformReports } from './table.ts'

const OPEN_VSX = 'https://open-vsx.org/api/anthropic/claude-code'
const FEATURES: readonly FeatureId[] = RECIPES.map(r => r.id)


/** The Open VSX target platform of the machine the robot runs on. */
export function openVsxPlatform (platform = process.platform, arch = process.arch) {
  const system = { darwin: 'darwin', win32: 'win32', linux: 'linux' }[platform as string]
  if (!system || !['x64', 'arm64'].includes(arch)) throw new Error(`no Claude Code build for ${platform}-${arch}`)
  return `${system}-${arch}`
}

async function fetchOk (url: string) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response
}

async function latestVersions (count: number) {
  const listing = await (await fetchOk(`${OPEN_VSX}/versions?size=${Math.max(count, 20)}`)).json() as { versions: Record<string, string> }
  return Object.keys(listing.versions).filter(v => /^\d+(\.\d+)*$/.test(v)).sort(newestFirst).slice(0, count)
}

/** Downloads one release for `platform` and writes its target files into a fresh Claude Code-shaped folder. */
async function downloadClaudeCode (version: string, platform: string, into: string) {
  const vsixUrl = `${OPEN_VSX}/${platform}/${version}/file/Anthropic.claude-code-${version}@${platform}.vsix`
  const zip = Buffer.from(await (await fetchOk(vsixUrl)).arrayBuffer())
  const wanted = ['package.json', ...TARGET_FILES].map(file => `extension/${file}`)
  const entries = readZipEntries(zip, wanted)
  const missing = wanted.filter(name => !entries.has(name))
  if (missing.length) throw new Error(`${version} (${platform}) has no ${missing.join(', ')}`)
  const dir = path.join(into, `anthropic.claude-code-${version}-${platform}`)
  for (const [name, bytes] of entries) {
    const target = path.join(dir, ...name.split('/').slice(1))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
  }
  return dir
}

const reportsFile = (compatDir: string, platform: string) => path.join(compatDir, `${platform}.json`)

function readReports (compatDir: string, platform: string): PlatformReports {
  try {
    return JSON.parse(fs.readFileSync(reportsFile(compatDir, platform), 'utf8'))
  } catch {
    return {}
  }
}

function writeTable (compatDir: string) {
  const byPlatform: Record<string, PlatformReports> = {}
  for (const name of fs.existsSync(compatDir) ? fs.readdirSync(compatDir) : []) {
    if (name.endsWith('.json')) byPlatform[name.slice(0, -5)] = readReports(compatDir, name.slice(0, -5))
  }
  fs.writeFileSync(path.join(compatDir, 'README.md'), renderCompatTable(byPlatform))
}

async function check (args: Map<string, string | true>, compatDir: string) {
  const platform = typeof args.get('--platform') === 'string' ? args.get('--platform') as string : openVsxPlatform()
  const reports = readReports(compatDir, platform)
  const asked = args.get('--version')
  const candidates = typeof asked === 'string' ? [asked] : await latestVersions(Number(args.get('--latest') ?? 3))
  const toCheck = args.has('--recheck') || typeof asked === 'string' ? candidates : candidates.filter(v => !reports[v])
  if (toCheck.length === 0) {
    console.log(`Nothing new for ${platform}: ${candidates.join(', ')} already checked.`)
    return 0
  }
  const problems: string[] = []
  for (const version of toCheck) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'enhancer-robot-'))
    try {
      const dir = await downloadClaudeCode(version, platform, work)
      const report = await checkClaudeCodeFolder(dir, new Engine(path.join(work, 'storage'), RECIPES), FEATURES, platform)
      reports[version] = report
      // Saved after each release, so a later download failure keeps what was checked.
      fs.mkdirSync(compatDir, { recursive: true })
      fs.writeFileSync(reportsFile(compatDir, platform), `${JSON.stringify(reports, null, 2)}\n`)
      writeTable(compatDir)
      const found = problemsIn(report)
      problems.push(...found)
      console.log(found.length ? found.join('\n') : `${version} (${platform}): all ${FEATURES.length} enhancements work, restore is byte-exact.`)
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
    }
  }
  return problems.length ? 1 : 0
}

async function main (argv: string[]) {
  const [command, ...rest] = argv
  const args = new Map<string, string | true>()
  for (let i = 0; i < rest.length; i++) {
    const next = rest[i + 1]
    if (next !== undefined && !next.startsWith('--')) args.set(rest[i], rest[++i])
    else args.set(rest[i], true)
  }
  const compatDir = path.resolve(typeof args.get('--compat') === 'string' ? args.get('--compat') as string : 'compat')
  if (command === 'check') return check(args, compatDir)
  if (command === 'table') {
    writeTable(compatDir)
    return 0
  }
  console.error('usage: robot check [--latest <n>] [--version <x.y.z>] [--platform <p>] [--recheck] [--compat <folder>] | robot table [--compat <folder>]')
  return 2
}

main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 2
})
