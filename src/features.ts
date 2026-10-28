// Which features the user's settings turn on. Kept apart from the editor API so it can be
// tested; every feature is on unless its setting says false.
import { DEFAULT_RECIPE_OPTIONS } from './engine/recipe.ts'
import type { FeatureId, RecipeOptions } from './engine/recipe.ts'
import { LANGUAGES } from './i18n/index.ts'
import type { LanguageId } from './i18n/index.ts'

/** Each feature and the `enhancer.<setting>` that turns it on or off. */
export const FEATURE_SETTINGS: { id: FeatureId; setting: string }[] = [
  { id: 'rtl', setting: 'arabic' },
  { id: 'broom', setting: 'broom' },
  { id: 'quoteReply', setting: 'quoteReply' },
  { id: 'quoteTools', setting: 'quoteTools' },
  { id: 'imagePreview', setting: 'imagePreview' },
]

/** The control panel's Interface switches (each an `enhancer.<setting>` that changes what is written). */
export const INTERFACE_SETTINGS = ['broomStartsOn', 'broomButton', 'languageEverywhere'] as const
export type InterfaceSetting = (typeof INTERFACE_SETTINGS)[number]

/** The broom's Interface choices, given a reader for `enhancer.<setting>` (undefined = the default). */
export function broomOptionsFrom (setting: (name: string) => boolean | undefined) {
  return {
    broomStartsOn: setting('broomStartsOn') ?? DEFAULT_RECIPE_OPTIONS.broomStartsOn,
    broomButton: setting('broomButton') ?? DEFAULT_RECIPE_OPTIONS.broomButton,
  }
}

/**
 * The language of everything outside the control panel (the chat's labels, the status bar,
 * notifications): the panel's language when "also in the chat and messages" is on (the
 * default), else English.
 */
export const outsideLanguage = (panelLanguage: LanguageId, everywhere: boolean | undefined): LanguageId =>
  everywhere ?? true ? panelLanguage : 'en'

/** The recipe options, given a reader for `enhancer.<setting>` and the chat's texts. */
export function recipeOptionsFrom (setting: (name: string) => boolean | undefined, text: RecipeOptions['text']): RecipeOptions {
  return { ...broomOptionsFrom(setting), text }
}

/** The features on, given a reader for `enhancer.<setting>` (undefined when the user never set it). */
export function enabledFeaturesFrom (setting: (name: string) => boolean | undefined): FeatureId[] {
  return FEATURE_SETTINGS.filter(f => setting(f.setting) ?? true).map(f => f.id)
}

/**
 * Whether Enhancer may change Claude Code: the user's stored "Turn on", or, for users of
 * an earlier version that applied without asking, Claude Code already holding Enhancer's
 * own changes.
 */
export function turnedOnFrom (stored: boolean | undefined, files: 'pristine' | 'enhanced' | 'modified-elsewhere' | undefined) {
  return stored ?? files === 'enhanced'
}

/** Every recipe option set the user's settings can produce (each language × each broom choice). */
export function allRecipeOptions (): RecipeOptions[] {
  return LANGUAGES.flatMap(({ text }) => [false, true].flatMap(broomStartsOn =>
    [true, false].map(broomButton => ({ broomStartsOn, broomButton, text }))))
}
