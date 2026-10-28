// The injection engine. Rules it keeps (PLAN.md §3):
// - A pristine baseline of every target file is captured before the first change, and
//   only from files that carry no injection marker.
// - Every apply starts from the baseline, so re-applying is idempotent.
// - Every Claude Code version is tried (owner, 2026-10-17): a recipe whose anchors are
//   missing or ambiguous, or whose output does not validate, fails alone and is reported;
//   its feature waits for an Enhancer update while the others stay applied.
// - Each recipe runs on its own; one failing leaves the others applied and is reported.
// - Writes are journaled, staged beside each file, then renamed. A journal left behind
//   (crash, closed editor) is recovered to pristine before anything else.
// - Restore puts the baseline bytes back exactly.
// - One operation at a time across processes: several editor windows share the storage
//   folder, so every public operation holds a lock file there.
// - What Enhancer last wrote is recorded by hash, so a newer Enhancer recognises the
//   output of an older one as its own (never as "modified elsewhere").
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import {
  FileLockedError, exactText, readIfExists, removeIfExists, renameWithRetry, sha256, stage,
  stagedPathOf, writeAtomic,
} from './files.ts'
import { DEFAULT_RECIPE_OPTIONS, INJECTION_MARKER, TARGET_FILES } from './recipe.ts'
import type { FeatureId, FileTexts, Recipe, RecipeOptions, TargetFile } from './recipe.ts'

type Bytes = Partial<Record<TargetFile, Buffer>>
type Hashes = Partial<Record<TargetFile, string>>

type BaselineManifest = {
  version: string
  /** The Claude Code folder this copy was taken from: the uninstall restore finds it here. */
  extensionDir: string
  files: Partial<Record<TargetFile, { sha256: string; size: number }>>
}

type Journal = { extensionDir: string; files: TargetFile[] }

export type FeatureResult = { id: FeatureId; outcome: 'applied' | 'failed'; reason?: string }

export type ApplyResult =
  | { outcome: 'applied'; changed: boolean; features: FeatureResult[] }
  | { outcome: 'modified-elsewhere'; reason: string }
  | { outcome: 'locked'; file: string }
  | { outcome: 'busy' }
  | { outcome: 'no-claude-code'; reason: string }

export type RestoreResult =
  | { outcome: 'restored'; changed: boolean }
  | { outcome: 'no-baseline' }
  | { outcome: 'locked'; file: string }
  | { outcome: 'busy' }

export type Status = {
  version: string | undefined
  baseline: 'none' | 'ok' | 'corrupt'
  /** pristine: matches the baseline (or untouched and clean); enhanced: what Enhancer last wrote; modified-elsewhere: anything else. */
  files: 'pristine' | 'enhanced' | 'modified-elsewhere'
  appliedFeatures: FeatureId[]
}

/** Another process (an editor window) holds the engine lock past the wait. */
export class EngineBusyError extends Error {}

const LOCK_WAIT_MS = 15_000
const LOCK_POLL_MS = 100
// A lock whose owner process is alive is only taken over past this age (a machine that
// slept mid-operation); a dead owner's lock is taken over at once.
const LOCK_STALE_MS = 10 * 60_000

/** True unless the process is known to be gone (ESRCH). */
function isAlive (pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const toNative = (relative: TargetFile) => path.join(...relative.split('/'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const hashesOf = (files: Bytes): Hashes =>
  Object.fromEntries(TARGET_FILES.filter(f => files[f]).map(f => [f, sha256(files[f]!)]))
const sameHashes = (a: Hashes, b: Hashes) => TARGET_FILES.every(f => a[f] === b[f])

export class Engine {
  private readonly storageDir: string
  private readonly recipes: readonly Recipe[]
  private readonly options: () => RecipeOptions
  private readonly possibleOptions: () => readonly RecipeOptions[]
  // The last answer of the slow check below (one build per option set), for the same files.
  private lastRebuildCheck: { key: string; ours: boolean } | undefined

  /**
   * @param storageDir where baselines, the journal and the lock live (the extension's global storage).
   * @param recipes every feature the engine knows, in the order they are applied.
   * @param options the user's current recipe options, read at every build.
   * @param possibleOptions every option set an earlier apply may have used: without the record of
   *   what was written, Enhancer's own files are recognised under any of them, not only the current one.
   */
  constructor (storageDir: string, recipes: readonly Recipe[], options: () => RecipeOptions = () => DEFAULT_RECIPE_OPTIONS,
    possibleOptions: () => readonly RecipeOptions[] = () => []) {
    this.storageDir = storageDir
    this.recipes = recipes
    this.options = options
    this.possibleOptions = possibleOptions
  }

  private baselineDirOf (extensionDir: string) {
    return path.join(this.storageDir, 'baselines', path.basename(extensionDir))
  }

  private get journalPath () {
    return path.join(this.storageDir, 'journal.json')
  }

  private get lockPath () {
    return path.join(this.storageDir, 'lock')
  }

  /** Runs `work` holding the cross-process lock; throws EngineBusyError if it stays taken. */
  private async locked<T> (work: () => Promise<T>): Promise<T> {
    await fs.promises.mkdir(this.storageDir, { recursive: true })
    const token = `${process.pid}:${crypto.randomUUID()}`
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        const handle = await fs.promises.open(this.lockPath, 'wx')
        await handle.writeFile(token)
        await handle.close()
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (await this.isStaleLock()) {
          // Taking over is a rename to a name of our own: atomic, so of two processes that
          // both saw the stale lock only one moves it; the other's rename finds nothing.
          const moved = path.join(this.storageDir, `lock.stale-${crypto.randomUUID()}`)
          if (await fs.promises.rename(this.lockPath, moved).then(() => true, () => false)) await removeIfExists(moved)
          continue
        }
        if (Date.now() > deadline) throw new EngineBusyError('another editor window is changing Claude Code')
        await sleep(LOCK_POLL_MS)
      }
    }
    try {
      return await work()
    } finally {
      // Released only if it is still ours (a stale takeover may have replaced it).
      const holder = await readIfExists(this.lockPath)
      if (holder?.toString('utf8') === token) await removeIfExists(this.lockPath)
    }
  }

  private async isStaleLock () {
    const [holder, stat] = await Promise.all([
      readIfExists(this.lockPath),
      fs.promises.stat(this.lockPath).catch(() => undefined),
    ])
    if (!holder || !stat) return false
    const pid = Number(holder.toString('utf8').split(':')[0])
    return !isAlive(pid) || Date.now() - stat.mtimeMs > LOCK_STALE_MS
  }

  async versionOf (extensionDir: string): Promise<string | undefined> {
    const bytes = await readIfExists(path.join(extensionDir, 'package.json'))
    if (!bytes) return undefined
    try {
      const version = JSON.parse(bytes.toString('utf8')).version
      return typeof version === 'string' ? version : undefined
    } catch {
      return undefined
    }
  }

  private async readTargets (dir: string) {
    const out: Bytes = {}
    for (const file of TARGET_FILES) {
      const bytes = await readIfExists(path.join(dir, toNative(file)))
      if (bytes) out[file] = bytes
    }
    return out
  }

  private async readManifest (baselineDir: string): Promise<BaselineManifest | undefined | 'corrupt'> {
    const bytes = await readIfExists(path.join(baselineDir, 'manifest.json'))
    if (!bytes) return undefined
    try {
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      return 'corrupt'
    }
  }

  /** The baseline's bytes, or undefined when absent; 'corrupt' when its hashes do not match. */
  private async readBaseline (extensionDir: string): Promise<Bytes | undefined | 'corrupt'> {
    const dir = this.baselineDirOf(extensionDir)
    const manifest = await this.readManifest(dir)
    if (!manifest || manifest === 'corrupt') return manifest
    const files = await this.readTargets(dir)
    for (const file of TARGET_FILES) {
      const expected = manifest.files[file]
      const bytes = files[file]
      if (!expected && !bytes) continue
      if (!expected || !bytes || sha256(bytes) !== expected.sha256) return 'corrupt'
    }
    return files
  }

  /** Hashes of what Enhancer last wrote to this Claude Code folder (pristine after a restore). */
  private async readWritten (extensionDir: string): Promise<Hashes | undefined> {
    const bytes = await readIfExists(path.join(this.baselineDirOf(extensionDir), 'written.json'))
    if (!bytes) return undefined
    try {
      return JSON.parse(bytes.toString('utf8'))
    } catch {
      return undefined
    }
  }

  /**
   * Captures the pristine baseline from the live files. Refuses (returns the reason) when
   * a file carries an injection marker: such a copy would make Restore lie.
   */
  private async captureBaseline (extensionDir: string, version: string): Promise<string | undefined> {
    const live = await this.readTargets(extensionDir)
    for (const file of TARGET_FILES) {
      const bytes = live[file]
      if (bytes && INJECTION_MARKER.test(bytes.toString('utf8'))) {
        return `${file} is already modified by an injection tool`
      }
    }
    const dir = this.baselineDirOf(extensionDir)
    const manifest: BaselineManifest = { version, extensionDir, files: {} }
    for (const file of TARGET_FILES) {
      const bytes = live[file]
      if (!bytes) continue
      await writeAtomic(path.join(dir, toNative(file)), bytes)
      manifest.files[file] = { sha256: sha256(bytes), size: bytes.length }
    }
    // The manifest is written last: a baseline without it is treated as absent.
    await writeAtomic(path.join(dir, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2)))
    return undefined
  }

  /**
   * Recovers an interrupted commit: every file it named goes back to its baseline bytes.
   * A journal that cannot be recovered (no usable baseline) is kept as journal.failed.json,
   * the only record of what was being written.
   */
  private async recoverUnlocked (): Promise<boolean> {
    const bytes = await readIfExists(this.journalPath)
    if (!bytes) return false
    let journal: Journal
    try {
      journal = JSON.parse(bytes.toString('utf8'))
    } catch {
      await fs.promises.rename(this.journalPath, path.join(this.storageDir, 'journal.failed.json'))
      return false
    }
    // Claude Code updated and its old folder is gone: nothing left to put back.
    if (!fs.existsSync(journal.extensionDir)) {
      await removeIfExists(this.journalPath)
      return true
    }
    const baseline = await this.readBaseline(journal.extensionDir)
    if (!baseline || baseline === 'corrupt') {
      await fs.promises.rename(this.journalPath, path.join(this.storageDir, 'journal.failed.json'))
      return false
    }
    await this.backToPristine(journal.extensionDir, baseline)
    await removeIfExists(this.journalPath)
    return true
  }

  /**
   * Puts every target file that is not pristine back to its baseline (staged leftovers
   * removed), then records what is really on disk as Enhancer's last write: a file that
   * could not be restored (still locked) is then still recognised as ours next time.
   */
  private async backToPristine (extensionDir: string, baseline: Bytes) {
    for (const file of TARGET_FILES) {
      const target = path.join(extensionDir, toNative(file))
      await removeIfExists(stagedPathOf(target))
      const pristine = baseline[file]
      const current = await readIfExists(target)
      if (pristine && !(current && current.equals(pristine))) await writeAtomic(target, pristine).catch(() => undefined)
    }
    const live = await this.readTargets(extensionDir)
    await writeAtomic(path.join(this.baselineDirOf(extensionDir), 'written.json'), Buffer.from(JSON.stringify(hashesOf(live))))
  }

  /** Writes `desired` over the live files: journaled, staged, renamed, verified, recorded. */
  private async commit (extensionDir: string, desired: Bytes, baseline: Bytes) {
    const live = await this.readTargets(extensionDir)
    const changing = TARGET_FILES.filter(file => desired[file] && !desired[file]!.equals(live[file] ?? Buffer.alloc(0)))
    const writtenPath = path.join(this.baselineDirOf(extensionDir), 'written.json')
    if (changing.length === 0) {
      await writeAtomic(writtenPath, Buffer.from(JSON.stringify(hashesOf(desired))))
      return false
    }

    // The journal comes first, so a crash while staging is recovered (and its staged
    // files removed) on the next start. It names every file that will not be pristine.
    const touched = TARGET_FILES.filter(file => changing.includes(file) || !(live[file] ?? Buffer.alloc(0)).equals(baseline[file] ?? Buffer.alloc(0)))
    await writeAtomic(this.journalPath, Buffer.from(JSON.stringify({ extensionDir, files: touched } satisfies Journal)))
    try {
      for (const file of changing) {
        const target = path.join(extensionDir, toNative(file))
        await renameWithRetry(await stage(target, desired[file]!), target)
      }
      for (const file of changing) {
        const written = await readIfExists(path.join(extensionDir, toNative(file)))
        if (!written || !written.equals(desired[file]!)) throw new Error(`${file} did not read back as written`)
      }
    } catch (error) {
      // Roll every file back to pristine (a locked one may stay as it was).
      await this.backToPristine(extensionDir, baseline).catch(() => undefined)
      await removeIfExists(this.journalPath)
      throw error
    }
    await writeAtomic(writtenPath, Buffer.from(JSON.stringify(hashesOf(desired))))
    await removeIfExists(this.journalPath)
    return true
  }

  /** What the enabled recipes produce from the baseline, and how each one went. */
  private build (baseline: Bytes, enabled: readonly FeatureId[], options: RecipeOptions = this.options()) {
    const texts: FileTexts = {}
    for (const file of TARGET_FILES) {
      const bytes = baseline[file]
      if (!bytes) continue
      const text = exactText(bytes)
      if (text !== undefined) texts[file] = text
    }
    const results: FeatureResult[] = []
    let current: FileTexts = { ...texts }
    for (const recipe of this.recipes) {
      if (!enabled.includes(recipe.id)) continue
      try {
        const changed = recipe.apply(current, options)
        const next = { ...current, ...changed }
        recipe.validate?.(current, next)
        current = next
        results.push({ id: recipe.id, outcome: 'applied' })
      } catch (error) {
        results.push({ id: recipe.id, outcome: 'failed', reason: (error as Error).message })
      }
    }
    const desired: Bytes = {}
    for (const file of TARGET_FILES) {
      const bytes = baseline[file]
      if (!bytes) continue
      desired[file] = current[file] !== undefined && current[file] !== texts[file] ? Buffer.from(current[file]!, 'utf8') : bytes
    }
    return { desired, results }
  }

  private async statusUnlocked (extensionDir: string): Promise<Status> {
    await this.recoverUnlocked()
    const version = await this.versionOf(extensionDir)
    const baseline = await this.readBaseline(extensionDir)
    const live = await this.readTargets(extensionDir)
    const liveText = TARGET_FILES.map(file => live[file]?.toString('utf8') ?? '').join('\n')
    const appliedFeatures = this.recipes.map(r => r.id).filter(id => liveText.includes(`/* Enhancer ${id.toUpperCase()} BEGIN */`))
    if (!baseline || baseline === 'corrupt') {
      return { version, baseline: baseline ? 'corrupt' : 'none', files: INJECTION_MARKER.test(liveText) ? 'modified-elsewhere' : 'pristine', appliedFeatures }
    }
    const liveHashes = hashesOf(live)
    if (sameHashes(liveHashes, hashesOf(baseline))) return { version, baseline: 'ok', files: 'pristine', appliedFeatures: [] }
    const written = await this.readWritten(extensionDir)
    // Without the record (deleted or damaged), the files are Enhancer's own when some option
    // set it could have written with rebuilds them exactly (the language or a broom choice may
    // have changed since).
    const isOurs = written ? sameHashes(liveHashes, written) : this.rebuildsAsOurs(baseline, liveHashes, appliedFeatures)
    return { version, baseline: 'ok', files: isOurs ? 'enhanced' : 'modified-elsewhere', appliedFeatures }
  }

  /** Whether some option set rebuilds exactly the live files; remembered for the same files. */
  private rebuildsAsOurs (baseline: Bytes, liveHashes: Hashes, applied: readonly FeatureId[]) {
    const key = JSON.stringify([hashesOf(baseline), liveHashes])
    if (this.lastRebuildCheck?.key === key) return this.lastRebuildCheck.ours
    const ours = [this.options(), ...this.possibleOptions()]
      .some(options => sameHashes(liveHashes, hashesOf(this.build(baseline, applied, options).desired)))
    this.lastRebuildCheck = { key, ours }
    return ours
  }

  private async applyUnlocked (extensionDir: string, enabled: readonly FeatureId[]): Promise<ApplyResult> {
    await this.recoverUnlocked()
    const version = await this.versionOf(extensionDir)
    if (!version) return { outcome: 'no-claude-code', reason: 'no package.json version in the Claude Code folder' }

    let baseline = await this.readBaseline(extensionDir)
    if (baseline === 'corrupt') return { outcome: 'modified-elsewhere', reason: 'the saved original copy is damaged' }
    if (!baseline) {
      const refused = await this.captureBaseline(extensionDir, version)
      if (refused) return { outcome: 'modified-elsewhere', reason: refused }
      baseline = await this.readBaseline(extensionDir)
      if (!baseline || baseline === 'corrupt') return { outcome: 'modified-elsewhere', reason: 'the original copy could not be saved' }
    } else {
      const status = await this.statusUnlocked(extensionDir)
      if (status.files === 'modified-elsewhere') {
        return { outcome: 'modified-elsewhere', reason: 'Claude Code was changed by something else since Enhancer saved its original copy' }
      }
    }

    const { desired, results } = this.build(baseline, enabled)
    const changed = await this.commit(extensionDir, desired, baseline)
    return { outcome: 'applied', changed, features: results }
  }

  private async restoreUnlocked (extensionDir: string): Promise<RestoreResult> {
    await this.recoverUnlocked()
    const baseline = await this.readBaseline(extensionDir)
    if (!baseline || baseline === 'corrupt') return { outcome: 'no-baseline' }
    const changed = await this.commit(extensionDir, baseline, baseline)
    return { outcome: 'restored', changed }
  }

  /** Maps the expected failures (a locked file, another window at work) to results. */
  private async guarded<T> (work: () => Promise<T>): Promise<T | { outcome: 'locked'; file: string } | { outcome: 'busy' }> {
    try {
      return await this.locked(work)
    } catch (error) {
      if (error instanceof FileLockedError) return { outcome: 'locked', file: error.file }
      if (error instanceof EngineBusyError) return { outcome: 'busy' }
      throw error
    }
  }

  /** Recovers an interrupted commit, if any. */
  recover (): Promise<boolean> {
    return this.locked(() => this.recoverUnlocked())
  }

  status (extensionDir: string): Promise<Status | { outcome: 'busy' } | { outcome: 'locked'; file: string }> {
    return this.guarded(() => this.statusUnlocked(extensionDir))
  }

  /**
   * Makes the live files exactly "baseline + the enabled features". With no feature
   * enabled this is a restore. Any Claude Code version is tried; each feature reports its own outcome.
   */
  apply (extensionDir: string, enabled: readonly FeatureId[]): Promise<ApplyResult> {
    return this.guarded(() => this.applyUnlocked(extensionDir, enabled))
  }

  /** Puts the saved original bytes back. Works for any version, supported or not. */
  restore (extensionDir: string): Promise<RestoreResult> {
    return this.guarded(() => this.restoreUnlocked(extensionDir))
  }

  /**
   * Restores every Claude Code folder this storage holds an original copy of and that
   * still holds Enhancer's own output (uninstall). An editor where Enhancer is still
   * installed is skipped: removing it from VS Code must not undo it in Cursor.
   */
  async restoreAll (options: { includeEditorsWithEnhancer?: boolean } = {}): Promise<{ extensionDir: string; result: RestoreResult }[]> {
    const root = path.join(this.storageDir, 'baselines')
    const names = await fs.promises.readdir(root).catch(() => [] as string[])
    const results: { extensionDir: string; result: RestoreResult }[] = []
    for (const name of names) {
      const manifest = await this.readManifest(path.join(root, name))
      if (!manifest || manifest === 'corrupt' || !fs.existsSync(manifest.extensionDir)) continue
      if (!options.includeEditorsWithEnhancer && enhancerStillInstalledBeside(manifest.extensionDir)) continue
      const status = await this.status(manifest.extensionDir)
      if (!('files' in status) || status.files !== 'enhanced') continue
      results.push({ extensionDir: manifest.extensionDir, result: await this.restore(manifest.extensionDir) })
    }
    return results
  }
}

/**
 * Whether an Enhancer extension folder sits beside this Claude Code folder (same editor)
 * and is not marked for removal in the editor's .obsolete list.
 */
export function enhancerStillInstalledBeside (claudeCodeDir: string) {
  const parent = path.dirname(claudeCodeDir)
  let obsolete: Record<string, unknown> = {}
  try {
    obsolete = JSON.parse(fs.readFileSync(path.join(parent, '.obsolete'), 'utf8'))
  } catch {}
  const names = (() => { try { return fs.readdirSync(parent) } catch { return [] as string[] } })()
  return names.some(name => name.toLowerCase().startsWith('enhancer.enhancer-for-claude-code-') && !(name in obsolete))
}
