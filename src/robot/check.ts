// What the maintenance robot checks on one pristine Claude Code folder (PLAN.md §3):
// pristine → apply every feature → re-apply (nothing changes) → restore (byte-exact),
// with the engine's state read between steps, and each feature's own outcome.
import * as fs from 'fs'
import * as path from 'path'

import { TARGET_FILES } from '../engine/recipe.ts'
import type { Engine } from '../engine/engine.ts'
import type { FeatureId } from '../engine/recipe.ts'

export type FeatureCheck = { state: 'active' } | { state: 'waiting'; reason: string }

export type VersionReport = {
  version: string
  platform: string
  checkedAt: string
  /** `broken` when applying or restoring did not keep the engine's promises: a release blocker. */
  safety: 'ok' | 'broken'
  safetyProblem?: string
  features: Partial<Record<FeatureId, FeatureCheck>>
}

type EngineSteps = Pick<Engine, 'apply' | 'restore' | 'status'>

function readTargets (dir: string) {
  return TARGET_FILES.map(file => fs.readFileSync(path.join(dir, ...file.split('/'))))
}

const sameBytes = (a: Buffer[], b: Buffer[]) => a.length === b.length && a.every((bytes, i) => bytes.equals(b[i]))

/** Runs the robot's steps on `claudeCodeDir`, which must hold an untouched copy of Claude Code. */
export async function checkClaudeCodeFolder (
  claudeCodeDir: string,
  engine: EngineSteps,
  features: readonly FeatureId[],
  platform: string,
): Promise<VersionReport> {
  const version = JSON.parse(fs.readFileSync(path.join(claudeCodeDir, 'package.json'), 'utf8')).version as string
  const report: VersionReport = { version, platform, checkedAt: new Date().toISOString(), safety: 'ok', features: {} }
  const broken = (problem: string) => ({ ...report, safety: 'broken' as const, safetyProblem: problem })

  const original = readTargets(claudeCodeDir)
  const before = await engine.status(claudeCodeDir)
  if (!('files' in before) || before.files !== 'pristine') return broken(`the untouched copy was not seen as original: ${JSON.stringify(before)}`)

  const first = await engine.apply(claudeCodeDir, features)
  if (first.outcome !== 'applied') return broken(`apply answered ${JSON.stringify(first)}`)
  for (const result of first.features) {
    report.features[result.id] = result.outcome === 'applied' ? { state: 'active' } : { state: 'waiting', reason: result.reason ?? 'no reason given' }
  }
  const active = first.features.filter(f => f.outcome === 'applied').map(f => f.id)
  const enhanced = readTargets(claudeCodeDir)

  const second = await engine.apply(claudeCodeDir, features)
  if (second.outcome !== 'applied' || second.changed) return broken(`applying again changed the files: ${JSON.stringify(second)}`)
  if (!sameBytes(readTargets(claudeCodeDir), enhanced)) return broken('applying again wrote different bytes')

  const during = await engine.status(claudeCodeDir)
  const expectedFiles = active.length > 0 ? 'enhanced' : 'pristine'
  if (!('files' in during) || during.files !== expectedFiles) return broken(`after apply the files were seen as ${JSON.stringify(during)}, expected ${expectedFiles}`)
  if (active.length > 0 && [...during.appliedFeatures].sort().join() !== [...active].sort().join()) {
    return broken(`the files hold ${during.appliedFeatures.join(', ')}, apply reported ${active.join(', ')}`)
  }

  const restored = await engine.restore(claudeCodeDir)
  if (restored.outcome !== 'restored' && !(active.length === 0 && restored.outcome === 'no-baseline')) {
    return broken(`restore answered ${JSON.stringify(restored)}`)
  }
  if (!sameBytes(readTargets(claudeCodeDir), original)) return broken('restore did not give back the original bytes')
  const after = await engine.status(claudeCodeDir)
  if (!('files' in after) || after.files !== 'pristine') return broken(`after restore the files were seen as ${JSON.stringify(after)}`)

  return report
}
