// The contract every feature recipe follows. A recipe turns pristine file texts into
// enhanced ones; it never touches the disk. The engine decides what is written.
import { en } from '../i18n/en.ts'
import type { Text } from '../i18n/en.ts'

/** Paths inside the Claude Code extension folder, always written with forward slashes. */
export const TARGET_FILES = ['webview/index.css', 'webview/index.js', 'extension.js'] as const
export type TargetFile = (typeof TARGET_FILES)[number]

export type FeatureId = 'rtl' | 'broom' | 'quoteReply' | 'quoteTools' | 'imagePreview'

export type FileTexts = Partial<Record<TargetFile, string>>

/**
 * The user's choices a recipe writes into what it injects (the injected scripts cannot read
 * the editor's settings), so changing one re-applies the files.
 */
export type RecipeOptions = {
  /** The broom is on (tool rows folded, finished thinking hidden) each time the chat opens. */
  broomStartsOn: boolean
  /** The broom button shows in the composer footer. */
  broomButton: boolean
  /** The texts of the labels and buttons the recipes add inside the chat (their `c_` keys). */
  text: Text
}
export const DEFAULT_RECIPE_OPTIONS: RecipeOptions = { broomStartsOn: false, broomButton: true, text: en }

/** Thrown by a recipe when an anchor it needs is missing or ambiguous in this version. */
export class AnchorError extends Error {}

export type Recipe = {
  id: FeatureId
  /** Returns the texts it changes (the others are left out), built from `texts`; no options = the defaults. */
  apply: (texts: FileTexts, options?: RecipeOptions) => FileTexts
  /** Throws when what `apply` produced is not safe to write (e.g. a script that does not parse). */
  validate?: (before: FileTexts, after: FileTexts) => void
}

/**
 * Markers that prove a file was changed by an injection tool: ours, and the ones the
 * owner's prototype (and its archived features) writes. A baseline is never taken from
 * a file holding one of them.
 */
export const INJECTION_MARKER = /\/\* (?:Enhancer [A-Za-z ]+|RTL Support|RTL Arabic Wins|CC [A-Za-z ]+|Tiko [A-Za-z ]+|Whisper STT) BEGIN \*\//
