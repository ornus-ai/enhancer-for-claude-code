// What the control panel shows, decided from the extension's facts. Kept apart from the
// editor API so every state can be tested; the webview only draws what this returns.
import type { ApplyResult, RestoreResult, Status } from '../engine/engine.ts'
import type { FeatureId } from '../engine/recipe.ts'
import { FEATURE_SETTINGS, broomOptionsFrom } from '../features.ts'
import { LANGUAGES, languageOf } from '../i18n/index.ts'
import type { LanguageId, LanguageSetting, Text } from '../i18n/index.ts'
import { featuresSummary } from './feedback.ts'
import type { FeedbackDetails, FeedbackResult } from './feedback.ts'
import type { NewsItem } from './news.ts'

export type PanelInput = {
  /** The user pressed "Turn on" (or Enhancer had already changed Claude Code before this version). */
  turnedOn: boolean
  /** `enhancer.<setting>` for each feature and Interface choice, undefined when never set (= its default). */
  featureSetting: (setting: string) => boolean | undefined
  reapplyAfterUpdate: boolean
  checkForUpdates: boolean
  ornusNews: boolean
  /** `enhancer.feedbackButton`: the "Send feedback" row shows in the panel. */
  feedbackButton: boolean
  /** The technical details a feedback message may carry, without the enhancements line (added here from the rows). */
  feedbackDetails: Omit<FeedbackDetails, 'features'>
  /** The answers to the last feedback sends of this window, by the id the page gave each. */
  feedbackAnswers: { id: string; result: FeedbackResult }[]
  /** undefined when Claude Code is not installed in this editor. */
  claudeCode: undefined | { status: Status | 'busy' | 'locked' }
  /** The last apply or restore this window ran on the current Claude Code folder. */
  lastResult: ApplyResult | RestoreResult | undefined
  syncing: boolean
  reloadPending: boolean
  /** A newer Enhancer version on the registry, when the check found one. */
  updateAvailable: string | undefined
  news: NewsItem | undefined
  /** An apply just finished with every feature applied: the mascot acknowledges it once. */
  justVerified: boolean
  /** `enhancer.language` and `enhancer.languageEverywhere` as the user set them. */
  language: { setting: LanguageSetting; everywhere: boolean }
}

/** A result counts only for the Claude Code folder it ran on (an update installs a new folder). */
export const resultForFolder = <R>(last: { dir: string; result: R } | undefined, dir: string | undefined) =>
  dir !== undefined && last?.dir === dir ? last.result : undefined

export type Mascot = 'welcome' | 'applying' | 'verified' | 'still' | null

export type StatusLine =
  | { kind: 'active'; version: string }
  | { kind: 'applying' }
  | { kind: 'off' }
  | { kind: 'partial'; active: number; total: number }
  | { kind: 'attention' }

export type Notice =
  | { kind: 'modified-elsewhere' }
  | { kind: 'locked' }
  | { kind: 'no-claude-code' }
  | { kind: 'not-applied'; version: string }
  | { kind: 'not-restored' }

/**
 * One enhancement. `active`: on and present in Claude Code's files (the row shows it in
 * green). `problem: 'failed'`: on but not applied to this Claude Code version (its anchors
 * moved): the row says it waits for an Enhancer update.
 */
export type FeatureRow = { id: FeatureId; setting: string; on: boolean; active?: true; problem?: 'failed'; reason?: string }

export type PanelState = {
  view: 'welcome' | 'main'
  mascot: Mascot
  status: StatusLine
  notice?: Notice
  features: FeatureRow[]
  /** Switches are greyed while a change is being written. */
  busy: boolean
  reloadPending: boolean
  updateAvailable?: string
  news?: NewsItem
  reapplyAfterUpdate: boolean
  checkForUpdates: boolean
  ornusNews: boolean
  feedback: { button: boolean; details: FeedbackDetails; answers: { id: string; result: FeedbackResult }[] }
  /** The Interface section's broom choices; `available` is false while the broom itself is off. */
  broomOptions: { startsOn: boolean; button: boolean; available: boolean }
  language: { setting: LanguageSetting; everywhere: boolean }
  canTurnOn: boolean
}

/** What the panel page needs to draw in a language: its texts, direction and the language list. */
export type PanelMeta = { version: string; lang: LanguageId; dir: 'ltr' | 'rtl'; text: Text; languages: { id: LanguageId; name: string }[] }

export function panelMeta (version: string, lang: LanguageId): PanelMeta {
  const { dir, text } = languageOf(lang)
  return { version, lang, dir, text, languages: LANGUAGES.map(({ id, name }) => ({ id, name })) }
}

export function panelState (input: PanelInput): PanelState {
  const status = input.claudeCode && typeof input.claudeCode.status === 'object' ? input.claudeCode.status : undefined
  const version = status?.version ?? '?'
  const last = input.lastResult
  const failures = new Map(
    last?.outcome === 'applied' ? last.features.filter(f => f.outcome !== 'applied').map(f => [f.id, f] as const) : [])
  // What the files really hold: after a restart the last result is gone, but a feature that
  // did not apply is still missing from Claude Code's files.
  const inFiles = status?.files === 'enhanced' ? status.appliedFeatures : undefined
  const features: FeatureRow[] = FEATURE_SETTINGS.map(({ id, setting }) => {
    const on = input.featureSetting(setting) ?? true
    const failure = on ? failures.get(id) : undefined
    if (failure) return { id, setting, on, problem: 'failed', reason: failure.reason }
    if (!on || !inFiles) return { id, setting, on }
    return inFiles.includes(id) ? { id, setting, on, active: true } : { id, setting, on, problem: 'failed' }
  })
  const enabled = features.filter(f => f.on)
  const options = broomOptionsFrom(input.featureSetting)

  const base = {
    features,
    busy: input.syncing,
    reloadPending: input.reloadPending && !input.syncing,
    updateAvailable: input.checkForUpdates ? input.updateAvailable : undefined,
    // The news slot never shows beside a problem (plan §6): only on a calm panel.
    news: undefined as NewsItem | undefined,
    reapplyAfterUpdate: input.reapplyAfterUpdate,
    checkForUpdates: input.checkForUpdates,
    ornusNews: input.ornusNews,
    feedback: { button: input.feedbackButton, details: { ...input.feedbackDetails, features: featuresSummary(features) }, answers: input.feedbackAnswers },
    broomOptions: { startsOn: options.broomStartsOn, button: options.broomButton, available: features.some(f => f.id === 'broom' && f.on) },
    language: input.language,
    canTurnOn: input.claudeCode !== undefined && !input.syncing,
  }
  const calm = (state: Omit<PanelState, keyof typeof base>): PanelState =>
    ({ ...base, ...state, news: input.ornusNews ? input.news : undefined })
  const troubled = (state: Omit<PanelState, keyof typeof base>): PanelState => ({ ...base, ...state })

  if (!input.turnedOn) {
    return input.claudeCode
      ? calm({ view: 'welcome', mascot: 'welcome', status: { kind: 'off' } })
      : troubled({ view: 'welcome', mascot: null, status: { kind: 'attention' }, notice: { kind: 'no-claude-code' } })
  }
  // Another editor window writing the same Claude Code reads as applying here too.
  if (input.syncing || input.claudeCode?.status === 'busy') return troubled({ view: 'main', mascot: 'applying', status: { kind: 'applying' } })
  if (!input.claudeCode) return troubled({ view: 'main', mascot: null, status: { kind: 'attention' }, notice: { kind: 'no-claude-code' } })

  if (enabled.length > 0) {
    if (last?.outcome === 'modified-elsewhere' || status?.files === 'modified-elsewhere') {
      return troubled({ view: 'main', mascot: null, status: { kind: 'attention' }, notice: { kind: 'modified-elsewhere' } })
    }
    if (last?.outcome === 'locked' || input.claudeCode.status === 'locked') {
      return troubled({ view: 'main', mascot: null, status: { kind: 'attention' }, notice: { kind: 'locked' } })
    }
  }
  if (enabled.length === 0) {
    // "Off" is only said once Claude Code is really back to its original files.
    if (last?.outcome === 'locked' || input.claudeCode.status === 'locked') {
      return troubled({ view: 'main', mascot: null, status: { kind: 'attention' }, notice: { kind: 'locked' } })
    }
    if (status?.files === 'enhanced') {
      return troubled({ view: 'main', mascot: null, status: { kind: 'attention' }, notice: { kind: 'not-restored' } })
    }
    return calm({ view: 'main', mascot: 'still', status: { kind: 'off' } })
  }
  // Still original after an apply here means no enabled feature fit this version: the rows
  // say each one waits for an update. Without such an apply, re-applying was off.
  if (status?.files === 'pristine' && last?.outcome !== 'applied') {
    return troubled({ view: 'main', mascot: 'still', status: { kind: 'attention' }, notice: { kind: 'not-applied', version } })
  }
  const broken = enabled.filter(f => f.problem)
  if (broken.length > 0) {
    return troubled({ view: 'main', mascot: null, status: { kind: 'partial', active: enabled.length - broken.length, total: enabled.length } })
  }
  return calm({ view: 'main', mascot: input.justVerified ? 'verified' : 'still', status: { kind: 'active', version } })
}
