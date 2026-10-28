// The languages Enhancer speaks and how one is chosen. English is the default and the
// fallback; the others follow by number of speakers (owner, 2026-10-18: "most spoken first";
// order from Ethnologue's total-speaker counts). Each translation lives in its own file and
// must hold every key of `en.ts` (checked by src/test/i18n.test.ts).
import { ar } from './ar.ts'
import { bn } from './bn.ts'
import { de } from './de.ts'
import { en } from './en.ts'
import type { Text } from './en.ts'
import { es } from './es.ts'
import { fa } from './fa.ts'
import { fr } from './fr.ts'
import { he } from './he.ts'
import { hi } from './hi.ts'
import { id } from './id.ts'
import { it } from './it.ts'
import { ja } from './ja.ts'
import { ko } from './ko.ts'
import { pl } from './pl.ts'
import { ptBr } from './pt-br.ts'
import { ru } from './ru.ts'
import { tr } from './tr.ts'
import { uk } from './uk.ts'
import { ur } from './ur.ts'
import { vi } from './vi.ts'
import { zhCn } from './zh-cn.ts'

export type { Text } from './en.ts'
export { en } from './en.ts'

/** Each language: its id (the editor's own locale id), its name in itself, its direction and texts. */
export const LANGUAGES = [
  { id: 'en', name: 'English', dir: 'ltr', text: en },
  { id: 'zh-cn', name: '简体中文', dir: 'ltr', text: zhCn },
  { id: 'hi', name: 'हिन्दी', dir: 'ltr', text: hi },
  { id: 'es', name: 'Español', dir: 'ltr', text: es },
  { id: 'ar', name: 'العربية', dir: 'rtl', text: ar },
  { id: 'fr', name: 'Français', dir: 'ltr', text: fr },
  { id: 'bn', name: 'বাংলা', dir: 'ltr', text: bn },
  { id: 'pt-br', name: 'Português (Brasil)', dir: 'ltr', text: ptBr },
  { id: 'ru', name: 'Русский', dir: 'ltr', text: ru },
  { id: 'id', name: 'Bahasa Indonesia', dir: 'ltr', text: id },
  { id: 'ur', name: 'اردو', dir: 'rtl', text: ur },
  { id: 'de', name: 'Deutsch', dir: 'ltr', text: de },
  { id: 'ja', name: '日本語', dir: 'ltr', text: ja },
  { id: 'vi', name: 'Tiếng Việt', dir: 'ltr', text: vi },
  { id: 'tr', name: 'Türkçe', dir: 'ltr', text: tr },
  { id: 'ko', name: '한국어', dir: 'ltr', text: ko },
  { id: 'fa', name: 'فارسی', dir: 'rtl', text: fa },
  { id: 'it', name: 'Italiano', dir: 'ltr', text: it },
  { id: 'pl', name: 'Polski', dir: 'ltr', text: pl },
  { id: 'uk', name: 'Українська', dir: 'ltr', text: uk },
  { id: 'he', name: 'עברית', dir: 'rtl', text: he },
] as const satisfies readonly { id: string; name: string; dir: 'ltr' | 'rtl'; text: Text }[]

export type LanguageId = (typeof LANGUAGES)[number]['id']
/** `enhancer.language`: a language id, or "auto" for the editor's own language. */
export type LanguageSetting = LanguageId | 'auto'

export const LANGUAGE_IDS: readonly LanguageId[] = LANGUAGES.map(l => l.id)
export const isLanguageSetting = (value: unknown): value is LanguageSetting =>
  value === 'auto' || (LANGUAGE_IDS as readonly unknown[]).includes(value)

/**
 * The language to show: the user's choice, or with "auto" (or anything unknown) the editor's
 * display language when Enhancer speaks it (a regional variant counts: "pt" → Brazilian
 * Portuguese, any Chinese → Simplified Chinese), else English.
 */
export function resolveLanguage (setting: unknown, editorLanguage: string): LanguageId {
  if (setting !== 'auto' && isLanguageSetting(setting)) return setting as LanguageId
  const locale = editorLanguage.toLowerCase()
  const exact = LANGUAGE_IDS.find(l => l === locale)
  if (exact) return exact
  const base = locale.split('-')[0]
  return LANGUAGE_IDS.find(l => l.split('-')[0] === base) ?? 'en'
}

export const languageOf = (id: LanguageId) => LANGUAGES.find(l => l.id === id)!

/** The texts of a language. */
export const textFor = (id: LanguageId): Text => languageOf(id).text

/** Fills `{0}`, `{1}`… in a text. */
export const fill = (text: string, ...args: (string | number)[]) =>
  text.replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)]))
