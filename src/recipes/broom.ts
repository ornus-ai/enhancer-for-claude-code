// The broom ("clean view"): the chat reads as text plus one-line tool headers. Ported
// from the prototype's apply_clean_view (claude code injection,
// app/engine/injector-engine.sh:4465), the behaviour the owner field-tested:
// - A broom button in the composer footer, one click on and one click off (owner,
//   2026-10-18: no long press). On: every tool row folds to its header, finished
//   "Thought for Ns" rows hide, and every new one is swept in the frame it appears; the
//   button shows VS Code's toggle look. Off: everything opens again.
// - Two choices in the control panel's Interface section (owner, 2026-10-18), written into
//   the script when it is applied: whether the broom is on each time the chat opens
//   (`enhancer.broomStartsOn`, default off; a click lasts until the chat reloads), and
//   whether its button shows (`enhancer.broomButton`, default shown; hidden, the −/+ per
//   row and the start state still work).
// - A −/+ before each tool row's name folds or opens just that row.
// - No jumping: a bulk sweep keeps the first message in view at the same screen position,
//   or stays pinned to the bottom when the reader was at the bottom.
// - The header (tool name + the call's description) is never touched.
// - A folded row keeps mini copies of its Image Preview thumbnails beside its header
//   (click = that preview's zoom), so sweeping never hides an image.
// Left out of the port: the placement beside the prototype's New Session button (not in
// the Enhancer); the broom goes first in the footer.
//
// Anchors: hashed CSS module classes. The tool row is `root_<h>` of the single
// `toolSummary_<h>` module; the footer is `inputFooterV2_<h>` of the single
// `footerButton_<h>` module (found in the script, where the buttons are built). The
// timeline (`timelineMessage_<h>`, its `message_<h>` and `messagesContainer_<h>`) and
// thinking (`thinking_<h>` of `thinkingSummary_<h>`) are optional: without them tool rows
// still fold, thinking rows are just not swept and no anchoring is done. Two distinct
// matches for any module are ambiguous and fail the recipe instead of guessing.
import * as vm from 'vm'

import { AnchorError, DEFAULT_RECIPE_OPTIONS } from '../engine/recipe.ts'
import type { FileTexts, Recipe, RecipeOptions } from '../engine/recipe.ts'
import { appendBlock, classesNamed } from './shared.ts'

export const BROOM_CSS_BEGIN = '/* Enhancer BROOM BEGIN */'
export const BROOM_CSS_END = '/* Enhancer BROOM END */'
export const BROOM_JS_BEGIN = '/* Enhancer BROOM Script BEGIN */'
export const BROOM_JS_END = '/* Enhancer BROOM Script END */'

/** The hash of the one `<name>_<hash>` module in `text`; undefined when absent, throws when ambiguous. */
function moduleHash (text: string, name: string, required: boolean) {
  const found = classesNamed(text, name)
  if (found.length > 1) throw new AnchorError(`${name}: ${found.length} different classes, expected 1`)
  if (found.length === 0) {
    if (required) throw new AnchorError(`${name} not found`)
    return undefined
  }
  return found[0].slice(name.length + 1)
}

/** `<name>_<hash>` when that class exists in `text`. */
function sibling (text: string, name: string, hash: string | undefined) {
  if (!hash) return undefined
  const cls = `${name}_${hash}`
  return classesNamed(text, name).includes(cls) ? cls : undefined
}

export type BroomClasses = ReturnType<typeof findBroomClasses>

export function findBroomClasses (css: string, js: string) {
  const toolHash = moduleHash(css, 'toolSummary', true)
  const toolRoot = sibling(css, 'root', toolHash)
  if (!toolRoot) throw new AnchorError(`root_${toolHash} not found beside toolSummary_${toolHash}`)
  const footerHash = moduleHash(js, 'footerButton', true)
  const footerRoot = sibling(js, 'inputFooterV2', footerHash)
  if (!footerRoot) throw new AnchorError(`inputFooterV2_${footerHash} not found beside footerButton_${footerHash}`)
  const timelineHash = moduleHash(css, 'timelineMessage', false)
  const thinkingHash = moduleHash(css, 'thinkingSummary', false)
  return {
    toolRoot,
    toolSummary: `toolSummary_${toolHash}`,
    footerRoot,
    footerButton: `footerButton_${footerHash}`,
    timeline: timelineHash && `timelineMessage_${timelineHash}`,
    message: sibling(css, 'message', timelineHash),
    messagesContainer: sibling(css, 'messagesContainer', timelineHash),
    thinking: sibling(css, 'thinking', thinkingHash),
  }
}

export function broomCss (c: BroomClasses) {
  return `.${c.toolRoot}.enh-broom-folded > :not(.${c.toolSummary}):not(.enh-broom-tg):not(.enh-broom-peek) { display: none !important; }
.${c.toolRoot}.enh-broom-folded { display: flex; align-items: center; gap: 6px; min-width: 0; }
.${c.toolRoot}.enh-broom-folded > .${c.toolSummary} { flex: 0 1 auto; min-width: 0; }
.enh-broom-hidden { display: none !important; }
.enh-broom-peek { display: none; }
.${c.toolRoot}.enh-broom-folded > .enh-broom-peek { display: inline-flex; flex: none; gap: 4px; align-items: center; }
.enh-broom-peek-img { height: 18px; width: auto; max-width: 40px; object-fit: cover; border-radius: 3px; border: 1px solid var(--app-input-border, rgba(128,128,128,.35)); cursor: zoom-in; }
.enh-broom-tg {
  position: absolute;
  left: -15px;
  top: 3px;
  width: 13px;
  height: 13px;
  padding: 0;
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font: 600 11px/1 var(--app-monospace-font-family, monospace);
  color: var(--app-secondary-foreground, #888);
  background: var(--app-primary-background, transparent);
  border: 1px solid var(--app-input-border, rgba(128,128,128,.35));
  border-radius: 3px;
  cursor: pointer;
  opacity: .55;
  z-index: 2;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity .12s ease;
}
.enh-broom-tg:hover { opacity: 1; }
.enh-broom-tg::before { content: "\\2212"; }
.${c.toolRoot}.enh-broom-folded > .enh-broom-tg::before { content: "+"; }
/* Sized, coloured and spaced like Claude Code's own square footer buttons (+, /): a 26px
   square, the primary text colour, no padding; scoped under the footer so it outranks
   Claude Code's rules for text footer buttons. On = VS Code's own toggle look (the search
   box's Match Case), from the theme's input-option colours: a background and an inner
   border (high-contrast themes keep the background transparent and show only the border). */
.${c.footerRoot} .${c.footerButton}.enh-broom-btn { justify-content: center; width: 26px; height: 26px; padding: 0; color: var(--app-primary-foreground); -webkit-user-select: none; user-select: none; }
.${c.footerRoot} .${c.footerButton}.enh-broom-btn svg { display: block; width: 26px; height: 26px; }
.${c.footerRoot} .${c.footerButton}.enh-broom-btn.enh-broom-auto { background-color: var(--vscode-inputOption-activeBackground, var(--app-ghost-button-hover-background)); color: var(--vscode-inputOption-activeForeground, var(--app-primary-foreground)); box-shadow: inset 0 0 0 1px var(--vscode-inputOption-activeBorder, transparent); }`
}

// Outline broom on Claude Code's 20-unit icon grid with its 1-unit line, inside the same
// 4.5–15.5 box as its + and / icons, so it reads as one of them.
const BROOM_SVG = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 4.5v4"/><rect x="7.5" y="8.5" width="5" height="2" rx="1"/><path d="M7.75 10.5 5.5 15.5h9l-2.25-5"/><path d="m8.75 13-.5 2.5M11.25 13l.5 2.5"/></svg>'

export function broomScript (c: BroomClasses, options: RecipeOptions = DEFAULT_RECIPE_OPTIONS) {
  return `;(function () {
  "use strict";
  try {
  if (window.__enhancerBroomInstalled) return;
  window.__enhancerBroomInstalled = true;

  var TOOL_ROOT = ${JSON.stringify(c.toolRoot)};
  var TOOL_SUMMARY = ${JSON.stringify(c.toolSummary)};
  var TIMELINE = ${JSON.stringify(c.timeline ?? '')};
  var MESSAGE = ${JSON.stringify(c.message ?? '')};
  var MSG_CONTAINER = ${JSON.stringify(c.messagesContainer ?? '')};
  var THINKING = ${JSON.stringify(c.thinking ?? '')};
  var FOOTER_ROOT = ${JSON.stringify(c.footerRoot)};
  var FOOTER_BTN = ${JSON.stringify(c.footerButton)};
  var T = ${JSON.stringify({ show: options.text.c_showDetails, hide: options.text.c_hideDetails, on: options.text.c_broomOn, off: options.text.c_broomOff })};
  var STARTS_ON = ${options.broomStartsOn ? 'true' : 'false'};
  var SHOW_BUTTON = ${options.broomButton ? 'true' : 'false'};
  var LIVE_THINKING = /^Thinking(\\.\\.\\.|…)/;
  var BROOM_SVG = ${JSON.stringify(BROOM_SVG)};

  var auto = STARTS_ON;

  // ---- rows ----------------------------------------------------------------
  // A sweepable row is a tool root (folds to its header) or the timeline message
  // that holds only a finished thinking block (hidden). data-enh-broom-seen marks
  // rows already met, so only rows that appear later are "new" for auto-sweep.

  function hasBody(root) {
    for (var c = root.firstElementChild; c; c = c.nextElementSibling) {
      if (c.classList.contains(TOOL_SUMMARY) || c.classList.contains("enh-broom-tg") || c.classList.contains("enh-broom-peek")) continue;
      return true;
    }
    return false;
  }

  function setToolFolded(root, isFolded) {
    root.classList.toggle("enh-broom-folded", isFolded);
    var tg = root.querySelector(":scope > .enh-broom-tg");
    if (tg) {
      var label = isFolded ? T.show : T.hide;
      tg.title = label;
      tg.setAttribute("aria-label", label);
    }
  }

  // What a folded row shows beside its header: mini copies of the Image Preview
  // thumbnails inside it (click = that preview's zoom). Rebuilt only when those images change.
  function updatePeek(root) {
    var summary = root.querySelector(":scope > ." + TOOL_SUMMARY);
    if (!summary) return;
    var thumbs = root.querySelectorAll(".enh-img-thumb");
    var peek = root.querySelector(":scope > .enh-broom-peek");
    if (!thumbs.length) { if (peek) peek.remove(); return; }
    // Same thumbnail elements with the same full sources: nothing to rebuild.
    if (peek && peek.previousSibling === summary && peek.__enhOrig && peek.__enhOrig.length === thumbs.length) {
      var same = true;
      for (var k = 0; k < thumbs.length && same; k++) same = peek.__enhOrig[k] === thumbs[k] && peek.__enhSrc[k] === thumbs[k].src;
      if (same) return;
    }
    if (!peek) {
      peek = document.createElement("span");
      peek.className = "enh-broom-peek";
      peek.addEventListener("mousedown", function (e) { e.stopPropagation(); }, true);
    }
    if (peek.previousSibling !== summary) root.insertBefore(peek, summary.nextSibling);
    peek.__enhOrig = Array.prototype.slice.call(thumbs);
    peek.__enhSrc = peek.__enhOrig.map(function (t) { return t.src; });
    peek.textContent = "";
    for (var i = 0; i < thumbs.length; i++) {
      (function (orig) {
        var img = document.createElement("img");
        img.className = "enh-broom-peek-img";
        img.src = orig.src;
        img.alt = "";
        img.draggable = false;
        img.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          var tile = orig.closest(".enh-img-tile");
          if (tile) tile.click();
        });
        peek.appendChild(img);
      })(thumbs[i]);
    }
  }

  function decorateTool(root) {
    var tg = root.querySelector(":scope > .enh-broom-tg");
    if (!hasBody(root)) {
      if (tg) tg.remove();
      var stale = root.querySelector(":scope > .enh-broom-peek");
      if (stale) stale.remove();
      return;
    }
    updatePeek(root);
    if (tg) return;
    tg = document.createElement("button");
    tg.type = "button";
    tg.className = "enh-broom-tg";
    tg.tabIndex = -1;
    tg.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    tg.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var next = !root.classList.contains("enh-broom-folded");
      keepAnchor(function () { setToolFolded(root, next); }, root);
    }, true);
    root.insertBefore(tg, root.firstChild);
    setToolFolded(root, root.classList.contains("enh-broom-folded"));
  }

  // The timeline message that holds this thinking block and nothing else.
  function thinkingRow(el) {
    if (!TIMELINE) return null;
    var msg = el.closest("." + TIMELINE);
    if (!msg || msg.querySelector("." + TOOL_ROOT)) return null;
    if ((msg.textContent || "").trim() !== (el.textContent || "").trim()) return null;
    return msg;
  }

  function thinkingLive(el) {
    var s = el.querySelector("summary, div");
    return LIVE_THINKING.test(((s || el).textContent || "").trim());
  }

  function toolRows() { return document.querySelectorAll("." + TOOL_ROOT); }
  function thinkingEls() { return THINKING ? document.querySelectorAll("." + THINKING) : []; }

  // ---- no-jump bulk changes --------------------------------------------------
  // Keep the first visible message that survives the change (or anchor) at the
  // same screen position; the scroller compensates for height removed or restored
  // above it.

  // The element that scrolls this one: a row inside a subagent's log pane scrolls
  // with that pane, not with the main chat.
  function scrollerOf(el) {
    for (var p = el.parentElement; p; p = p.parentElement) {
      var oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
  }

  function keepAnchor(change, anchor) {
    var scroller = anchor
      ? scrollerOf(anchor)
      : (MSG_CONTAINER ? document.querySelector("." + MSG_CONTAINER) : null);
    if (!scroller) { change(); return; }
    // Reading the latest message: stay pinned to the bottom.
    if (!anchor && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8) {
      change();
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (!anchor) {
      // First message that starts inside the viewport (else the one cut by its
      // top edge), skipping thinking rows that the sweep may hide.
      var top = scroller.getBoundingClientRect().top, cut = null;
      var msgs = scroller.querySelectorAll("." + (MESSAGE || TIMELINE));
      for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        if (THINKING && m.querySelector("." + THINKING) && !m.querySelector("." + TOOL_ROOT)) continue;
        var r = m.getBoundingClientRect();
        if (r.bottom <= top || r.height === 0) continue;
        if (r.top >= top - 1) { anchor = m; break; }
        if (!cut) cut = m;
      }
      if (!anchor) anchor = cut;
    }
    if (!anchor) { change(); return; }
    var before = anchor.getBoundingClientRect().top;
    change();
    if (!anchor.isConnected || anchor.offsetParent === null) return;
    var delta = anchor.getBoundingClientRect().top - before;
    if (delta) scroller.scrollTop += delta;
  }

  // ---- sweep ------------------------------------------------------------------
  function collect() {
    var tools = [], thinks = [], i, r;
    var rows = toolRows();
    for (i = 0; i < rows.length; i++) if (hasBody(rows[i])) tools.push(rows[i]);
    var th = thinkingEls();
    for (i = 0; i < th.length; i++) {
      if (thinkingLive(th[i])) continue;
      r = thinkingRow(th[i]);
      if (r) thinks.push(r);
    }
    return { tools: tools, thinks: thinks };
  }

  // Sweeps every row present now (sweep) or opens them all again (!sweep).
  function sweepAll(sweep) {
    var c = collect(), i;
    keepAnchor(function () {
      for (i = 0; i < c.tools.length; i++) setToolFolded(c.tools[i], sweep);
      for (i = 0; i < c.thinks.length; i++) c.thinks[i].classList.toggle("enh-broom-hidden", sweep);
    });
  }

  // ---- scan (every DOM change, batched per frame, before paint) ---------------
  function scanRows() {
    var rows = toolRows(), i, el, r;
    for (i = 0; i < rows.length; i++) {
      el = rows[i];
      if (!el.hasAttribute("data-enh-broom-seen")) {
        el.setAttribute("data-enh-broom-seen", "1");
        if (auto) setToolFolded(el, true);
      }
      decorateTool(el);
    }
    var th = thinkingEls();
    for (i = 0; i < th.length; i++) {
      el = th[i];
      if (el.hasAttribute("data-enh-broom-seen")) continue;
      // A live block is "met" only once it finished, so auto-sweep waits for it.
      if (thinkingLive(el)) continue;
      el.setAttribute("data-enh-broom-seen", "1");
      if (auto && (r = thinkingRow(el))) r.classList.add("enh-broom-hidden");
    }
  }

  // ---- broom --------------------------------------------------------------------
  function paintBroom(btn) {
    btn.classList.toggle("enh-broom-auto", auto);
    var label = auto ? T.on : T.off;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", auto ? "true" : "false");
  }

  function setAuto(next) {
    auto = next;
    var brooms = document.querySelectorAll("[data-enh-broom]");
    for (var j = 0; j < brooms.length; j++) paintBroom(brooms[j]);
    sweepAll(auto);
  }

  function buildBroom() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = FOOTER_BTN + " enh-broom-btn";
    btn.setAttribute("data-enh-broom", "1");
    btn.innerHTML = BROOM_SVG;
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      setAuto(!auto);
    });
    paintBroom(btn);
    return btn;
  }

  // The broom is the footer's first button.
  function decorateFooter(footer) {
    var broom = footer.querySelector(":scope > [data-enh-broom]");
    if (broom && broom === footer.firstChild) return;
    footer.insertBefore(broom || buildBroom(), footer.firstChild);
  }

  var scheduled = false;
  function scan() {
    scheduled = false;
    try {
      scanRows();
      if (!SHOW_BUTTON) return;
      var footers = document.querySelectorAll("." + FOOTER_ROOT);
      for (var j = 0; j < footers.length; j++) decorateFooter(footers[j]);
    } catch (_) {}
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  function start() {
    // A broom that starts on folds the rows already on screen too, and its button shows on.
    scan();
    // characterData: a thinking row's "Thinking…" → "Thought for Ns" is a text change only.
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  } catch (_) {}
})();`
}

export const broomRecipe: Recipe = {
  id: 'broom',
  // Verified on the pristine copies of these versions (anchors and the round trip).
  apply (texts: FileTexts, options: RecipeOptions = DEFAULT_RECIPE_OPTIONS): FileTexts {
    const css = texts['webview/index.css']
    const js = texts['webview/index.js']
    if (css === undefined) throw new AnchorError('webview/index.css is missing')
    if (js === undefined) throw new AnchorError('webview/index.js is missing')
    const classes = findBroomClasses(css, js)
    return {
      'webview/index.css': appendBlock(css, BROOM_CSS_BEGIN, broomCss(classes), BROOM_CSS_END),
      // The leading ";" ends whatever statement the bundle's last line left open.
      'webview/index.js': appendBlock(js, `;${BROOM_JS_BEGIN}`, broomScript(classes, options), `;${BROOM_JS_END}`),
    }
  },
  validate (_before, after) {
    const js = after['webview/index.js'] ?? ''
    const start = js.lastIndexOf(BROOM_JS_BEGIN)
    if (start < 0) throw new Error('the broom script block is missing')
    // The injected script must parse on its own; the bundle around it is untouched.
    new vm.Script(js.slice(start + BROOM_JS_BEGIN.length, js.lastIndexOf(BROOM_JS_END) - 1))
    const css = after['webview/index.css'] ?? ''
    if (!css.includes(BROOM_CSS_BEGIN) || !css.includes(BROOM_CSS_END)) throw new Error('the broom style block is missing')
    const rules = css.slice(css.lastIndexOf(BROOM_CSS_BEGIN) + BROOM_CSS_BEGIN.length).replace(/\/\*[\s\S]*?\*\//g, '')
    if (/\.(?=[\s,{])|\.undefined\b/.test(rules)) throw new Error('an empty selector slipped into the style block')
  },
}
