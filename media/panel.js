// Enhancer control panel (webview side). Draws the PanelState the extension sends
// (src/panel/state.ts) and posts the user's actions back. Every text from outside
// (news) is set as text, never as HTML.
(function () {
  'use strict'
  const vscode = acquireVsCodeApi()
  // The texts arrive with every state, in the panel's language (src/i18n, chosen by the extension).
  let meta = { version: '', lang: document.documentElement.lang || 'en', dir: document.documentElement.dir || 'ltr', text: {}, languages: [] }
  const t = (key, ...args) => String(meta.text[key] ?? key).replace(/\{(\d)\}/g, (_, i) => String(args[Number(i)]))

  // Static, trusted icon markup (never built from outside data).
  const ICON = {
    rtl: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M16 5H6M16 9H9M16 13H6"/><path d="M5 12l-2 2 2 2"/></svg>',
    broom: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5l-3 5"/><path d="M7.5 8.5h6l1.5 3.5H6z"/><path d="M6 12l-1.5 4.5M9 12l-.5 4.5M12 12l.5 4.5M15 12l1 4.5"/></svg>',
    quoteReply: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6L4 10l4 4"/><path d="M4 10h7a5 5 0 0 1 5 5v1"/></svg>',
    quoteTools: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="9" height="9" rx="2"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/></svg>',
    imagePreview: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="M17 13l-4-4-7 7"/></svg>',
    notify: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a4 4 0 0 1 8 0c0 4 2 5 2 5H4s2-1 2-5z"/><path d="M8.5 16a1.6 1.6 0 0 0 3 0"/></svg>',
    voice: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 10a5 5 0 0 0 10 0M10 15v2"/></svg>',
    diff: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><path d="M7 8h3M8.5 6.5v3M7 13h3"/></svg>',
    lock: '<svg class="lock" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="6" width="8" height="6" rx="1.5"/><path d="M5 6V4.5a2 2 0 0 1 4 0V6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l4 4-4 4"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v3.6" stroke-linecap="round"/><circle cx="8" cy="5.1" r=".7" fill="currentColor" stroke="none"/></svg>',
    feedback: '<svg class="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-6l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 8.5h6M7 11h4"/></svg>',
    x: '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
    art: '<svg viewBox="0 0 210 120" fill="none" stroke="var(--art-line)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 22h96a16 16 0 0 1 16 16v30a16 16 0 0 1-16 16H72l-18 14v-14H40a16 16 0 0 1-16-16V38a16 16 0 0 1 16-16z" fill="var(--art-1)"/><path d="M44 40h60M44 52h80M44 64h40"/><path d="M96 46h82a14 14 0 0 1 14 14v28a14 14 0 0 1-14 14h-10v14l-18-14H96a14 14 0 0 1-14-14V60a14 14 0 0 1 14-14z" fill="var(--art-2)"/><path d="M178 64h-62M178 76h-46M178 88h-70"/></svg>',
  }

  // h(tag, attrs, ...children): strings become text nodes; attrs.html takes trusted static markup only.
  function h (tag, attrs, ...children) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === false) continue
      if (k === 'html') el.innerHTML = v
      else if (k === 'className') el.className = v
      else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'title' || k === 'disabled' || k === 'dir') el.setAttribute(k, v === true ? '' : String(v))
      else el[k] = v
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
    return el
  }
  const icon = name => { const s = document.createElement('span'); s.innerHTML = ICON[name]; return s.firstChild }

  // ---------- Bubble, the mascot (same pixels as the mascot board) ----------
  const put = (g, x, y, ch) => { if (y < 0 || y >= g.length || x < 0 || x >= g[y].length) return; g[y] = g[y].slice(0, x) + ch + g[y].slice(x + 1) }
  const hole = (g, x, y, w, ht) => { for (let j = 0; j < ht; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, '.') }
  function eyes (g, mode, look) {
    for (const x0 of [6, 12]) {
      const x = x0 + (look || 0), top = 4
      if (mode === 'open') hole(g, x, top, 2, 3)
      if (mode === 'blink') hole(g, x, top + 2, 2, 1)
      if (mode === 'calm') hole(g, x, top + 1, 2, 2)
      if (mode === 'happy') { hole(g, x, top, 2, 1); put(g, x - 1, top + 1, '.'); put(g, x + 2, top + 1, '.') }
    }
    return g
  }
  const BUBBLE = [
    '....############....', '..################..', '.##################.', '.##################.',
    '####################', '####################', '####################', '####################',
    '####################', '####################', '.##################.', '.##################.',
    '..################..', '....############....', '....####............', '....###.............',
    '....##..............',
  ]
  const typing = (g, n) => { [[13, 9], [9, 9], [5, 9]].slice(0, n).forEach(([x, y]) => hole(g, x, y, 2, 2)); return g }
  const bub = (mode, look, dots) => typing(eyes([...BUBBLE], mode, look), dots || 0)
  const squash = (g, row) => ({ g: [...g.slice(0, row), ...g.slice(row + 1)], dy: 1 })
  const ANIM = {
    welcome: { ms: 150, loop: true, frames: [
      { g: bub('open') }, squash(bub('open'), 6), { g: bub('open'), dy: -2 }, { g: bub('open'), dy: -3 },
      { g: bub('open'), dy: -2 }, squash(bub('open'), 6), { g: bub('open') }, { g: bub('open') },
      { g: bub('blink') }, { g: bub('open') }, { g: bub('open') }, { g: bub('open') }, { g: bub('open') },
    ] },
    applying: { ms: 230, loop: true, frames: [0, 1, 2, 3, 3, 0].map((n, i) => ({ g: bub('open', -1, n), dy: i % 2 ? -1 : 0 })) },
    // Plays once, then rests on the still pose.
    verified: { ms: 150, loop: false, frames: [
      { g: bub('open') }, squash(bub('happy'), 6), { g: bub('happy'), dy: -3 }, { g: bub('happy'), dy: -1 },
      squash(bub('happy'), 6), { g: bub('happy') }, { g: bub('happy') }, { g: bub('happy') }, { g: bub('calm') },
    ] },
    still: { frames: [{ g: bub('calm') }] },
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  let timers = []
  function drawFrame (svg, f) {
    const ox = f.dx || 0, oy = f.dy || 0
    let out = ''
    f.g.forEach((row, y) => { for (let x = 0; x < row.length;) { if (row[x] !== '#') { x++; continue } let w = 1; while (row[x + w] === '#') w++; out += `<rect x="${x + ox}" y="${y + oy}" width="${w}" height="1"/>`; x += w } })
    svg.innerHTML = out
  }
  function mascot (name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', className || 'mascot')
    svg.setAttribute('viewBox', '-2 -4 24 22')
    svg.setAttribute('shape-rendering', 'crispEdges')
    svg.setAttribute('fill', 'currentColor')
    svg.setAttribute('aria-hidden', 'true')
    svg.dataset.mascot = name
    const anim = ANIM[name]
    if (reduced || anim.frames.length < 2) { drawFrame(svg, name === 'verified' ? ANIM.still.frames[0] : anim.frames[0]); return svg }
    let i = 0
    drawFrame(svg, anim.frames[0])
    const id = setInterval(() => {
      i++
      if (i >= anim.frames.length) {
        if (!anim.loop) { clearInterval(id); drawFrame(svg, ANIM.still.frames[0]); return }
        i = 0
      }
      drawFrame(svg, anim.frames[i])
    }, anim.ms)
    timers.push(id)
    return svg
  }

  // ---------- Rendering ----------
  const app = document.getElementById('app')
  let state = null
  let infoOpen = false
  const send = message => vscode.postMessage(message)

  function toggle (on, disabled, action, setting, label) {
    return h('button', { className: 'tg', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, disabled, 'data-action': action, 'data-setting': setting })
  }

  function statusLine (s) {
    const tone = { active: '', applying: '', off: 'off', partial: 'warn', attention: 'warn' }[s.kind]
    const text = {
      active: () => t('s_active', s.version), applying: () => t('s_applying'), off: () => t('s_off'),
      partial: () => t('s_partial', s.active, s.total), attention: () => t('s_attention'),
    }[s.kind]()
    return h('div', { className: 'status ' + tone, id: 'status-line' },
      s.kind === 'applying' ? h('span', { className: 'spin' }) : h('i', { className: 'dot' }), h('span', {}, text))
  }

  function notice (n) {
    const key = { 'modified-elsewhere': 'modified', locked: 'locked', 'no-claude-code': 'missing', 'not-applied': 'notApplied', 'not-restored': 'notRestored' }[n.kind]
    const action = n.kind === 'locked' ? h('button', { className: 'btn', 'data-action': 'reload' }, t('reload'))
      : n.kind === 'not-applied' ? h('button', { className: 'btn primary', 'data-action': 'applyNow' }, t('applyNow'))
      : n.kind === 'not-restored' ? h('button', { className: 'btn primary', 'data-action': 'applyNow' }, t('tryAgain')) : null
    return h('div', { className: 'notice-wrap', id: 'notice' },
      h('div', { className: 'card notice', 'data-notice': n.kind }, h('b', {}, t(`n_${key}_t`, n.version)), h('p', {}, t(`n_${key}_p`)), action))
  }

  function featureRow (f, busy) {
    const label = t('f_' + f.id)
    if (f.problem === 'failed') {
      return h('button', { className: 'row row-btn', id: 'row-' + f.id, 'data-action': 'featureProblem', 'data-feature': f.id },
        icon(f.id), h('div', { className: 't' }, label), h('span', { className: 'badge wait' }, h('i', { className: 'dot' }), t('waitingUpdate')), icon('chev'))
    }
    return h('div', { className: 'row', id: 'row-' + f.id },
      icon(f.id), h('div', { className: 't' }, label),
      f.active ? h('span', { className: 'badge ok' }, h('i', { className: 'dot' }), t('active')) : null,
      toggle(f.on, busy, 'setFeature', f.setting, label))
  }

  function lockedRow (id, iconName, key, valueKey) {
    return h('div', { className: 'row locked', id: 'row-' + id },
      icon(iconName), h('div', { className: 't' }, t(key)), h('span', { className: 'v' }, t(valueKey)), icon('lock'))
  }

  function optionRow (id, key, on, setting, busy, action) {
    return h('div', { className: 'row', id: 'row-' + id }, h('div', { className: 't' }, t(key)), toggle(on, busy, action || 'setOption', setting, t(key)))
  }

  function languageRow (s) {
    const select = h('select', { className: 'select', id: 'language-select', 'data-action': 'setLanguage', 'aria-label': t('language') },
      h('option', { value: 'auto' }, t('langAuto')),
      meta.languages.map(l => h('option', { value: l.id, lang: l.id }, l.name)))
    select.value = s.language.setting
    return h('div', { className: 'row', id: 'row-language' }, h('div', { className: 't' }, t('language')), select)
  }

  function newsSlot (n) {
    return h('div', { className: 'section', id: 'section-news' },
      h('div', { className: 'card news', id: 'news-slot' },
        h('button', { className: 'news-open', 'data-action': 'openNews' },
          h('span', { className: 'ornus-mark', 'aria-hidden': 'true' }, 'O'),
          h('span', { className: 't' }, h('b', {}, n.title[meta.lang] || n.title.en), h('small', {}, n.text[meta.lang] || n.text.en))),
        h('button', { className: 'x', 'data-action': 'dismissNews', 'data-id': n.id, title: t('dismiss'), 'aria-label': t('dismiss') }, icon('x'))))
  }

  function welcome (s) {
    return h('div', { className: 'panel', id: 'welcome' },
      h('div', { className: 'center' },
        s.mascot ? mascot(s.mascot) : null,
        h('h2', {}, t('w_title')),
        h('p', {}, t('w_text')),
        s.notice ? notice(s.notice) : h('button', { className: 'btn primary big', 'data-action': 'turnOn', disabled: !s.canTurnOn }, t('w_button')),
        h('div', { className: 'fine' }, t('w_fine'))))
  }

  function main (s) {
    const head = h('header', { className: 'head', id: 'main-head' },
      s.mascot ? mascot(s.mascot) : null,
      h('div', {}, h('h1', {}, t('title')), statusLine(s.status)),
      h('div', { className: 'art', 'aria-hidden': 'true', html: ICON.art }))

    const banners = []
    if (s.reloadPending) {
      banners.push(h('div', { className: 'banner', id: 'reload-banner' },
        h('div', { className: 't' }, t('reloadReady')),
        h('button', { className: 'btn', 'data-action': 'later' }, t('later')),
        h('button', { className: 'btn primary', 'data-action': 'reload' }, t('reload'))))
    }
    if (s.updateAvailable) {
      banners.push(h('div', { className: 'banner', id: 'update-banner' },
        h('div', { className: 't' }, t('updateReady', s.updateAvailable)),
        h('button', { className: 'btn primary', 'data-action': 'update' }, t('update'))))
    }

    return h('div', { className: 'panel', id: 'main' },
      head, banners, s.notice ? notice(s.notice) : null,
      h('div', { className: 'section', id: 'section-enhancements' },
        h('h2', { className: 'section-t' }, t('enhancements')),
        h('div', { className: 'card' }, s.features.map(f => featureRow(f, s.busy)))),
      h('div', { className: 'section', id: 'section-interface' },
        h('h2', { className: 'section-t' }, t('interface')),
        h('div', { className: 'card' },
          languageRow(s),
          optionRow('language-everywhere', 'i_languageEverywhere', s.language.everywhere, 'languageEverywhere', false, 'setInterface'),
          optionRow('broom-starts-on', 'i_broomStartsOn', s.broomOptions.startsOn, 'broomStartsOn', s.busy || !s.broomOptions.available, 'setInterface'),
          optionRow('broom-button', 'i_broomButton', s.broomOptions.button, 'broomButton', s.busy || !s.broomOptions.available, 'setInterface'),
          optionRow('feedback-button', 'i_feedbackButton', s.feedback.button, 'feedbackButton', false))),
      h('div', { className: 'section', id: 'section-ornus' },
        h('h2', { className: 'section-t' }, t('inOrnus')),
        h('div', { className: 'card' },
          lockedRow('notify', 'notify', 'o_notify', 'availableInOrnus'),
          lockedRow('voice', 'voice', 'o_voice', 'availableInOrnus'),
          lockedRow('diff', 'diff', 'o_diff', 'comingToOrnus'),
          h('div', { className: 'row', id: 'row-download-ornus' }, h('div', { className: 't' }), h('button', { className: 'btn', 'data-action': 'downloadOrnus' }, t('downloadOrnus'))))),
      s.news ? newsSlot(s.news) : null,
      h('div', { className: 'section', id: 'section-privacy' },
        h('h2', { className: 'section-t' }, t('privacy'),
          h('button', { className: 'info', 'data-action': 'info', 'aria-expanded': infoOpen ? 'true' : 'false', title: t('privacyInfo'), 'aria-label': t('privacyInfo') }, icon('info'))),
        infoOpen ? h('p', { className: 'info-note', id: 'privacy-note' }, t('privacyNote')) : null,
        h('div', { className: 'card' },
          optionRow('reapply', 'reapply', s.reapplyAfterUpdate, 'reapplyAfterUpdate', false),
          optionRow('check-updates', 'checkUpdates', s.checkForUpdates, 'checkForUpdates', false),
          optionRow('news-toggle', 'news', s.ornusNews, 'ornusNews', false))),
      h('div', { className: 'section', id: 'section-bottom' },
        h('div', { className: 'card' },
          s.feedback.button ? h('button', { className: 'row row-btn', id: 'row-feedback', 'data-action': 'feedback', 'aria-haspopup': 'dialog' }, icon('feedback'), h('div', { className: 't' }, t('fb_row')), icon('chev')) : null,
          h('button', { className: 'row row-btn', id: 'row-diagnostics', 'data-action': 'openLog' }, h('div', { className: 't' }, t('diagnostics')), icon('chev')),
          h('button', { className: 'row row-btn danger', id: 'row-restore', 'data-action': 'restore', disabled: s.busy }, h('div', { className: 't' }, t('restore'))))),
      h('div', { className: 'foot', id: 'foot' },
        h('span', {}, meta.version ? 'v' + meta.version : ''), h('span', {}, t('notAffiliated')), h('span', {}, t('builtWith'))))
  }

  // ---------- Feedback dialog ----------
  // Lives outside #app, so the page redrawing on every state never loses what the user typed.
  // The draft stays until it is sent; Esc or Cancel only closes the dialog. A hidden tab drops
  // its page, so the draft, the dialog and a send in flight are kept with the editor's
  // webview state and restored when the tab shows again. The send's answer comes back in the
  // panel state (feedback.last, matched by the send's id), so it is not lost while hidden.
  const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  // The same cleaning the extension applies before sending (cleanFeedbackText): text made only
  // of invisible characters leaves Send off.
  // eslint-disable-next-line no-control-regex
  const hasText = text => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() !== ''
  const saved = (vscode.getState && vscode.getState()) || {}
  let draft = saved.draft || { kind: 'suggestion', text: '', email: '', attach: true }
  let fbStatus = saved.fbStatus || 'idle' // idle | sending | sent
  let fbPendingId = saved.fbPendingId || ''
  let fbErrorKey = saved.fbErrorKey || ''
  let fbWasOpen = saved.fbOpen === true
  let fbLang = ''
  let dialog = null
  const saveFeedback = () => {
    if (vscode.setState) vscode.setState({ draft, fbStatus, fbPendingId, fbErrorKey, fbOpen: !!(dialog && dialog.open) })
  }

  function detailsText () {
    const d = state.feedback.details
    return [`Enhancer ${d.extension}`, `Claude Code ${d.claudeCode}`, d.editor, d.os, `Language: ${meta.lang}`, `Enhancements: ${d.features}`].join('\n')
  }

  function feedbackForm () {
    const kindButton = kind => h('button', { type: 'button', role: 'radio', 'aria-checked': draft.kind === kind ? 'true' : 'false', 'data-fb': 'kind', 'data-kind': kind }, t('fb_' + kind))
    const sending = fbStatus === 'sending'
    return h('div', { className: 'fb-in' },
      h('div', { className: 'fb-head' }, h('h2', { id: 'fb-title' }, t('fb_title')),
        h('button', { type: 'button', className: 'x', 'data-fb': 'close', title: t('fb_cancel'), 'aria-label': t('fb_cancel') }, icon('x'))),
      h('div', { className: 'seg', role: 'radiogroup', 'aria-label': t('fb_title') }, kindButton('suggestion'), kindButton('problem')),
      h('textarea', { id: 'fb-text', dir: 'auto', maxLength: 2000, value: draft.text, placeholder: t(draft.kind === 'problem' ? 'fb_placeholderProblem' : 'fb_placeholderSuggestion'), 'aria-label': t('fb_title'), disabled: sending }),
      h('input', { id: 'fb-email', className: 'fb-email', type: 'email', dir: 'auto', maxLength: 254, value: draft.email, placeholder: t('fb_email'), 'aria-label': t('fb_email'), disabled: sending }),
      h('div', {},
        h('label', { className: 'fb-check' }, h('input', { id: 'fb-attach', type: 'checkbox', checked: draft.attach, disabled: sending }), h('span', {}, t('fb_attach'))),
        h('details', { className: 'fb-what' }, h('summary', {}, t('fb_seeDetails')), h('pre', { className: 'fb-details', id: 'fb-details' }, detailsText()))),
      fbErrorKey ? h('p', { className: 'fb-error', id: 'fb-error', role: 'alert' }, t(fbErrorKey)) : null,
      h('div', { className: 'fb-foot' },
        h('button', { type: 'button', className: 'btn', 'data-fb': 'close' }, t('fb_cancel')),
        h('button', { type: 'button', className: 'btn primary', id: 'fb-send', 'data-fb': 'send', disabled: sending || !hasText(draft.text) }, t(sending ? 'fb_sending' : 'fb_send'))))
  }

  function feedbackDone () {
    return h('div', { className: 'fb-in fb-done' },
      mascot('verified', 'mascot'),
      h('h2', { id: 'fb-title' }, t('fb_sent')),
      h('div', { className: 'fb-foot center-foot' }, h('button', { type: 'button', className: 'btn primary', 'data-fb': 'close' }, t('fb_close'))))
  }

  function drawFeedback (focusId) {
    fbLang = meta.lang
    dialog.replaceChildren(fbStatus === 'sent' ? feedbackDone() : feedbackForm())
    const target = focusId && dialog.querySelector('#' + focusId)
    if (target) target.focus()
    saveFeedback()
  }

  function openFeedback (options) {
    if (!dialog) {
      dialog = h('dialog', { className: 'fb', id: 'feedback-dialog', 'aria-labelledby': 'fb-title' })
      document.body.append(dialog)
      dialog.addEventListener('click', onFeedbackClick)
      dialog.addEventListener('input', event => {
        const el = event.target
        if (el.id === 'fb-text') { draft.text = el.value; dialog.querySelector('#fb-send').disabled = fbStatus === 'sending' || !hasText(draft.text) }
        if (el.id === 'fb-email') draft.email = el.value
        if (el.id === 'fb-attach') draft.attach = el.checked
        saveFeedback()
      })
      dialog.addEventListener('close', () => { if (fbStatus === 'sent') fbStatus = 'idle'; saveFeedback() })
    }
    // A failed send's message stays until the next send, even across closing the dialog. A
    // thank-you restored with the tab stays until the user closes it.
    if (fbStatus === 'sent' && !(options && options.restoring)) fbStatus = 'idle'
    // Opened first: an element inside a closed dialog cannot take the focus.
    if (!dialog.open) dialog.showModal()
    drawFeedback(fbStatus === 'idle' ? 'fb-text' : '')
  }

  function onFeedbackClick (event) {
    const el = event.target.closest('[data-fb]')
    if (!el || el.disabled) return
    const what = el.dataset.fb
    if (what === 'close') { dialog.close(); return }
    if (what === 'kind') { draft.kind = el.dataset.kind; drawFeedback(); dialog.querySelector(`[data-kind="${draft.kind}"]`).focus(); return }
    if (what === 'send') {
      if (fbStatus === 'sending') return
      const email = draft.email.trim()
      if (email && !EMAIL_LIKE.test(email)) { fbErrorKey = 'fb_badEmail'; drawFeedback('fb-email'); return }
      fbStatus = 'sending'
      fbErrorKey = ''
      fbPendingId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
      drawFeedback()
      send({ type: 'sendFeedback', id: fbPendingId, kind: draft.kind, text: draft.text, email: draft.email, attach: draft.attach })
    }
  }

  function onFeedbackResult (result) {
    fbPendingId = ''
    if (result === 'sent') {
      fbStatus = 'sent'
      fbErrorKey = ''
      draft = { kind: 'suggestion', text: '', email: draft.email, attach: true }
    } else {
      fbStatus = 'idle'
      fbErrorKey = { rate: 'fb_rate', daily: 'fb_daily', failed: 'fb_failed' }[result] || 'fb_unavailable'
    }
    if (!dialog || !dialog.open) {
      // Answered while the dialog was closed: a thank-you is not shown later, an error is.
      if (fbStatus === 'sent') fbStatus = 'idle'
      saveFeedback()
      return
    }
    drawFeedback(fbStatus === 'sent' ? '' : 'fb-send')
    if (fbStatus === 'sent') dialog.querySelector('[data-fb="close"]').focus()
  }

  /** Each new state: the answer to a send in flight, the details shown, and the language. */
  function feedbackOnState () {
    // Reopened first after the tab comes back, so the answer below shows in the dialog.
    if (fbWasOpen) { fbWasOpen = false; if (state.view === 'main' && state.feedback.button) openFeedback({ restoring: true }) }
    const answer = fbStatus === 'sending' && fbPendingId && state.feedback.answers.find(a => a.id === fbPendingId)
    if (answer) { onFeedbackResult(answer.result); return }
    if (!dialog || !dialog.open) return
    if (fbLang !== meta.lang && fbStatus !== 'sending') { drawFeedback(); return }
    const pre = dialog.querySelector('#fb-details')
    if (pre) pre.textContent = detailsText()
  }

  function render () {
    timers.forEach(clearInterval)
    timers = []
    // Each state redraws the page: the control the user is on (e.g. the language list while
    // they move through it with the arrow keys) keeps the focus.
    const focused = app.contains(document.activeElement) ? document.activeElement.id : ''
    app.replaceChildren(state.view === 'welcome' ? welcome(state) : main(state))
    if (focused) document.getElementById(focused)?.focus()
  }

  app.addEventListener('click', event => {
    const el = event.target.closest('[data-action]')
    if (!el || el.disabled) return
    const action = el.dataset.action
    if (action === 'info') { infoOpen = !infoOpen; render(); return }
    if (action === 'feedback') { openFeedback(); return }
    if (action === 'setFeature' || action === 'setOption' || action === 'setInterface') {
      const on = el.getAttribute('aria-checked') !== 'true'
      el.setAttribute('aria-checked', on ? 'true' : 'false') // answer the click at once; the next state confirms it
      send({ type: action, setting: el.dataset.setting, on })
      return
    }
    if (action === 'dismissNews') { send({ type: 'dismissNews', id: el.dataset.id }); return }
    if (action === 'featureProblem') { send({ type: 'featureProblem', id: el.dataset.feature }); return }
    send({ type: action })
  })

  app.addEventListener('change', event => {
    const el = event.target.closest('select[data-action="setLanguage"]')
    if (el) send({ type: 'setLanguage', language: el.value })
  })

  window.addEventListener('message', event => {
    const message = event.data
    if (!message || message.type !== 'state') return
    state = message.state
    if (message.meta) meta = message.meta
    document.documentElement.lang = meta.lang
    document.documentElement.dir = meta.dir
    render()
    feedbackOnState()
  })
  send({ type: 'ready' })
})()
