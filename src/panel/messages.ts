// The messages the control panel's webview may send, checked before the extension acts:
// anything unknown, or a setting outside the allowed lists, is dropped.
import { FEATURE_SETTINGS, INTERFACE_SETTINGS } from '../features.ts'
import type { InterfaceSetting } from '../features.ts'
import { isLanguageSetting } from '../i18n/index.ts'
import { FEEDBACK_EMAIL_MAX, FEEDBACK_KINDS, FEEDBACK_TEXT_MAX } from './feedback.ts'
import type { FeedbackDraft } from './feedback.ts'
import type { LanguageSetting } from '../i18n/index.ts'

export const OPTION_SETTINGS = ['reapplyAfterUpdate', 'checkForUpdates', 'ornusNews', 'feedbackButton'] as const
export type OptionSetting = (typeof OPTION_SETTINGS)[number]

export type PanelMessage =
  | { type: 'ready' | 'turnOn' | 'applyNow' | 'reload' | 'later' | 'restore' | 'openLog' | 'downloadOrnus' | 'openNews' | 'update' }
  | { type: 'setFeature'; setting: string; on: boolean }
  | { type: 'setOption'; setting: OptionSetting; on: boolean }
  | { type: 'setInterface'; setting: InterfaceSetting; on: boolean }
  | { type: 'setLanguage'; language: LanguageSetting }
  | { type: 'dismissNews'; id: string }
  | { type: 'featureProblem'; id: string }
  | ({ type: 'sendFeedback'; id: string } & FeedbackDraft)

const SIMPLE = new Set(['ready', 'turnOn', 'applyNow', 'reload', 'later', 'restore', 'openLog', 'downloadOrnus', 'openNews', 'update'])

export function parsePanelMessage (raw: unknown): PanelMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Record<string, unknown>
  if (typeof m.type !== 'string') return undefined
  if (SIMPLE.has(m.type)) return { type: m.type as 'ready' }
  if (m.type === 'setFeature' && typeof m.on === 'boolean' && FEATURE_SETTINGS.some(f => f.setting === m.setting)) {
    return { type: 'setFeature', setting: m.setting as string, on: m.on }
  }
  if (m.type === 'setOption' && typeof m.on === 'boolean' && (OPTION_SETTINGS as readonly unknown[]).includes(m.setting)) {
    return { type: 'setOption', setting: m.setting as OptionSetting, on: m.on }
  }
  if (m.type === 'setInterface' && typeof m.on === 'boolean' && (INTERFACE_SETTINGS as readonly unknown[]).includes(m.setting)) {
    return { type: 'setInterface', setting: m.setting as InterfaceSetting, on: m.on }
  }
  if (m.type === 'setLanguage' && isLanguageSetting(m.language)) return { type: 'setLanguage', language: m.language }
  if ((m.type === 'dismissNews' || m.type === 'featureProblem') && typeof m.id === 'string' && m.id.length <= 64) {
    return { type: m.type, id: m.id }
  }
  // The extension checks the draft again (isSendable) before posting it.
  if (m.type === 'sendFeedback' && typeof m.id === 'string' && /^[a-z0-9]{1,32}$/.test(m.id) && (FEEDBACK_KINDS as readonly unknown[]).includes(m.kind) && typeof m.attach === 'boolean'
    && typeof m.text === 'string' && m.text.length <= FEEDBACK_TEXT_MAX * 2
    && typeof m.email === 'string' && m.email.length <= FEEDBACK_EMAIL_MAX * 2) {
    return { type: 'sendFeedback', id: m.id, kind: m.kind as FeedbackDraft['kind'], text: m.text, email: m.email, attach: m.attach }
  }
  return undefined
}
