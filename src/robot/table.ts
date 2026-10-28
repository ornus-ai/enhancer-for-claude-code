// The robot's pure parts: version order, the public compatibility table, and what in a
// report needs the developer. Kept apart from the command so tests can import them.
import { RECIPES } from '../recipes/index.ts'
import type { FeatureId } from '../engine/recipe.ts'
import type { VersionReport } from './check.ts'

export type PlatformReports = Record<string, VersionReport>

const FEATURES: readonly FeatureId[] = RECIPES.map(r => r.id)
const FEATURE_NAMES: Record<FeatureId, string> = { rtl: 'Arabic RTL', broom: 'Broom', quoteReply: 'Quote reply', quoteTools: 'Quote tools', imagePreview: 'Image preview' }

/** Compares dotted numeric versions; newest first when used with sort. */
export const newestFirst = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

/** The public compatibility table, one row per Claude Code version and system, newest first. */
export function renderCompatTable (byPlatform: Record<string, PlatformReports>) {
  const rows = Object.values(byPlatform).flatMap(reports => Object.values(reports))
    .sort((a, b) => newestFirst(a.version, b.version) || a.platform.localeCompare(b.platform))
  const cell = (report: VersionReport, id: FeatureId) => {
    if (report.safety === 'broken') return '—'
    const check = report.features[id]
    return check?.state === 'active' ? '✅ works' : check ? '⏳ waiting for an update' : '—'
  }
  return [
    '# Claude Code compatibility',
    '',
    'Written by the maintenance robot (`src/robot/`). Each row is one Claude Code release from Open VSX on one system:',
    'every enhancement applied, applied again with no change, then restored byte for byte.',
    '',
    `| Claude Code | System | ${FEATURES.map(id => FEATURE_NAMES[id]).join(' | ')} | Safe restore | Checked |`,
    `|---|---|${FEATURES.map(() => '---|').join('')}---|---|`,
    ...rows.map(r => `| ${r.version} | ${r.platform} | ${FEATURES.map(id => cell(r, id)).join(' | ')} | ${r.safety === 'ok' ? '✅' : `❌ ${r.safetyProblem ?? ''}`} | ${r.checkedAt.slice(0, 10)} |`),
    '',
  ].join('\n')
}

/** What needs the developer: the engine broke, or a feature does not fit the release. */
export function problemsIn (report: VersionReport) {
  if (report.safety === 'broken') return [`${report.version} (${report.platform}): safety broken: ${report.safetyProblem}`]
  return Object.entries(report.features)
    .filter(([, check]) => check.state === 'waiting')
    .map(([id, check]) => `${report.version} (${report.platform}): ${FEATURE_NAMES[id as FeatureId]} waiting: ${check.state === 'waiting' ? check.reason : ''}`)
}
