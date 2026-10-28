// The status bar entry: always there, one click opens the control panel (the way Claude
// Code's own "✻ Claude Code" entry sits in the same bar).
import { textFor } from './i18n/index.ts'
import type { LanguageId } from './i18n/index.ts'

export const OPEN_PANEL_COMMAND = 'enhancer.openPanel'
/** The view behind the activity bar icon; showing it opens the control panel. */
export const HOME_VIEW = 'enhancer.home'

export function statusBarEntry (lang: LanguageId) {
  return {
    text: '$(comment-discussion) Enhancer',
    tooltip: textFor(lang).sb_tooltip,
    command: OPEN_PANEL_COMMAND,
  }
}

/**
 * What the activity bar view does when it shows or hides: it opens the panel when shown,
 * except when it was already shown as the editor started (the editor restoring its last
 * layout, not the user clicking the icon); from its first hide on, every show opens it.
 */
export function homeViewVisibilityHandler (visibleAtStart: boolean, openPanel: () => void) {
  let restoredAtStart = visibleAtStart
  return (visible: boolean) => {
    if (!visible) restoredAtStart = false
    else if (!restoredAtStart) openPanel()
  }
}
