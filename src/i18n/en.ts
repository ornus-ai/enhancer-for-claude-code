// Every text Enhancer shows, in English: the source each translation in this folder follows
// key for key. `{0}`, `{1}`… are filled in at run time and must stay in every translation.
// Keys: panel texts have no prefix; `sb_` the status bar; `m_` the editor's notifications;
// `c_` the small labels Enhancer adds inside the Claude Code chat.
export const en = {
  // ---- control panel ----
  title: 'Enhancer for Claude Code',
  enhancements: 'Enhancements', interface: 'Interface', inOrnus: 'In Ornus', privacy: 'Privacy and updates',
  language: 'Language', langAuto: 'Automatic', i_languageEverywhere: 'Also in the Claude chat and messages',
  i_broomStartsOn: 'Broom on by default', i_broomButton: 'Show the broom icon', i_feedbackButton: 'Show “Send feedback”',
  f_rtl: 'Right-to-left text (RTL)', f_broom: 'Broom — fold tool rows', f_quoteReply: 'Quote reply', f_quoteTools: 'Quote tools — copy and select', f_imagePreview: 'Image preview',
  o_notify: 'Notification and sound when Claude finishes', o_voice: 'Arabic voice input', o_diff: 'Review changes across files',
  comingToOrnus: 'Coming to Ornus', availableInOrnus: 'Available in Ornus', downloadOrnus: 'Download Ornus',
  reapply: 'Re-apply after Claude Code updates', checkUpdates: 'Check for Enhancer updates', news: 'Ornus news',
  privacyNote: 'No account and no telemetry. The update check asks your editor\'s extension store (Visual Studio Marketplace or Open VSX) for the latest version; Ornus news reads a small text file from ornus.ai. Neither sends anything about you, your code or your chats. Feedback is sent only when you press Send, with only what the form shows.',
  privacyInfo: 'About privacy',
  diagnostics: 'Diagnostics log', restore: 'Restore original Claude Code',
  notAffiliated: 'Not affiliated with Anthropic', builtWith: 'Built with Ornus',
  s_active: 'Active on Claude Code {0}', s_applying: 'Applying enhancements…', s_off: 'Off — Claude Code is original',
  s_partial: '{0} of {1} enhancements active', s_attention: 'Needs attention',
  active: 'Active', waitingUpdate: 'Waiting for an update',
  reloadReady: 'Ready. Reload the editor to see it.', later: 'Later', reload: 'Reload',
  updateReady: 'Enhancer {0} is available.', update: 'Update',
  n_modified_t: 'Another tool changed Claude Code', n_modified_p: 'Enhancer left it as it is. Restore it in that tool, then Enhancer can work again.',
  n_locked_t: 'A Claude Code file is in use', n_locked_p: 'Reload the editor, then Enhancer tries again.',
  n_missing_t: "Claude Code isn't installed in this editor", n_missing_p: 'Install Claude Code, then come back here.',
  n_notRestored_t: 'Claude Code still has the enhancements', n_notRestored_p: 'Enhancer could not put the original files back yet.', tryAgain: 'Try again',
  n_notApplied_t: 'Enhancements are not on for Claude Code {0} yet', n_notApplied_p: 'Claude Code updated while re-applying after updates is off.', applyNow: 'Apply now',
  w_title: 'A calmer Claude Code chat that reads right-to-left languages', w_text: 'Right-to-left text, the broom, and quote reply.',
  w_button: 'Turn on enhancements', w_fine: "Changes only Claude Code's own files. Restore any time.",
  dismiss: 'Dismiss',
  fb_row: 'Send feedback', fb_title: 'Send feedback', fb_suggestion: 'Suggestion', fb_problem: 'Problem',
  fb_placeholderSuggestion: 'What would make Enhancer better for you?', fb_placeholderProblem: 'What happened, and what did you expect?',
  fb_email: 'Email for a reply (optional)', fb_attach: 'Include technical details', fb_seeDetails: 'What is sent',
  fb_send: 'Send', fb_sending: 'Sending…', fb_cancel: 'Cancel', fb_close: 'Close',
  fb_sent: 'Thank you. Your message reached us.',
  fb_failed: 'Could not send. Check your connection and try again.', fb_rate: 'Too many messages. Try again in a minute.',
  fb_badEmail: 'This email does not look right.', fb_unavailable: 'Feedback is not available right now. Please try again later.',
  fb_daily: 'You have reached today\'s limit for messages. Please try again tomorrow.',

  // ---- status bar ----
  sb_tooltip: 'Open the Enhancer control panel',

  // ---- notifications ----
  m_notApplied: 'Enhancer could not apply to this Claude Code version: {0}. These wait for an Enhancer update; Claude Code works as before for them.',
  m_ready: 'Enhancer is ready. Reload the window to see the changes in Claude Code.',
  m_already: 'Enhancer is already applied.',
  m_modified: 'Enhancer left Claude Code untouched: {0}. If another tool changes Claude Code, restore it there first.',
  m_locked: 'A Claude Code file is in use. Reload the window, then Enhancer will try again.',
  m_restored: 'Claude Code is back to its original look. Reload the window to see it.',
  m_error: 'Enhancer hit an unexpected error and left Claude Code as it was. Details: Output → Enhancer.',
  m_restoreAsk: 'Restore original Claude Code?',
  m_restoreDetail: 'Every enhancement is turned off and Claude Code goes back to its original files. You can turn them on again at any time.',
  m_restoreButton: 'Restore',
  m_featureProblem: 'This enhancement does not fit this Claude Code version yet and waits for an Enhancer update. Claude Code works as before for it.',
  m_showLog: 'Show log', m_turnOff: 'Turn off', m_reloadWindow: 'Reload Window',
  m_noClaude: 'Claude Code is not installed in this editor.',
  m_busy: 'Another editor window is updating Claude Code right now. Try again in a moment.',
  m_status: 'Claude Code {0}: {1}. Original copy saved: {2}.',
  m_original: 'original', m_enhanced: 'enhanced ({0})', m_changedElsewhere: 'changed by another tool', m_yes: 'yes', m_no: 'no',

  // ---- inside the Claude Code chat ----
  c_showDetails: 'Show details', c_hideDetails: 'Hide details',
  c_broomOn: 'Broom on: tool details and thinking are hidden, new ones too (click to show them)',
  c_broomOff: 'Broom: hide tool details and thinking in this chat, new ones too',
  c_copy: 'Copy', c_reply: 'Reply', c_copied: 'Copied', c_copyFailed: 'Copy failed', c_removeQuote: 'Remove quote',
  c_select: 'Select', c_selected: 'Selected', c_copyQuote: 'Copy quote', c_selectQuote: 'Select quote',
  c_openOnDisk: 'Open on disk', c_zoom: 'Zoom', c_close: 'Close (Esc)',
  c_previewUnavailable: 'Preview unavailable', c_imageTooLarge: 'Image too large to preview',
}

export type Text = Record<keyof typeof en, string>
