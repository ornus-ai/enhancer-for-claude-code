// Quote tools: a Copy + Select pair in the top-left corner of every markdown quote in
// the chat. Ported from the prototype's apply_quote_tools (claude code injection,
// app/engine/injector-engine.sh:4866), the behaviour the owner field-tested:
// - The pair is a span floated left as the quote's first child (text wraps around it,
//   not selectable). Select selects from after the pair to the quote's end; Copy selects
//   the same range, copies its trimmed text as plain text (paragraph breaks kept), then
//   clears the selection. The button says Copied / Selected / Copy failed for a moment.
// - A body-wide MutationObserver (50 ms throttle) re-adds or re-orders the pair when
//   React re-renders a quote while a reply streams in.
// - Quotes in an editable area and in the quote reply tray are left alone.
// DOM only: it needs no Claude Code class names. Differences from the prototype: its own
// class prefix (enh-qt-) and no console log.
import * as vm from 'vm'

import { AnchorError, DEFAULT_RECIPE_OPTIONS } from '../engine/recipe.ts'
import type { FileTexts, Recipe, RecipeOptions } from '../engine/recipe.ts'
import { en } from '../i18n/en.ts'
import type { Text } from '../i18n/en.ts'
import { appendBlock } from './shared.ts'

export const QUOTE_TOOLS_CSS_BEGIN = '/* Enhancer QUOTETOOLS BEGIN */'
export const QUOTE_TOOLS_CSS_END = '/* Enhancer QUOTETOOLS END */'
export const QUOTE_TOOLS_JS_BEGIN = '/* Enhancer QUOTETOOLS Script BEGIN */'
export const QUOTE_TOOLS_JS_END = '/* Enhancer QUOTETOOLS Script END */'

export const QUOTE_TOOLS_CSS = `.enh-qt-bar {
  float: left;
  display: inline-flex;
  gap: 4px;
  margin: 2px 10px 4px 0;
  direction: ltr;
  user-select: none;
  -webkit-user-select: none;
}
.enh-qt-btn {
  padding: 2px 8px;
  font-size: 11px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--vscode-foreground, #ccc);
  background: var(--vscode-button-secondaryBackground, rgba(127,127,127,0.18));
  border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.35));
  border-radius: 4px;
  opacity: 0.75;
  cursor: pointer;
}
.enh-qt-btn:hover {
  opacity: 1;
  background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,0.3));
}`

export function quoteToolsScript (text: Text = en) {
  return `;(function(){
  try {
    if (window.__enhancerQuoteToolsInstalled) return;
    window.__enhancerQuoteToolsInstalled = true;
    var T = ${JSON.stringify({ copy: text.c_copy, select: text.c_select, copied: text.c_copied, selected: text.c_selected, copyFailed: text.c_copyFailed, copyQuote: text.c_copyQuote, selectQuote: text.c_selectQuote })};

    // Range over the quote's content, excluding the toolbar (always first child).
    function quoteRange(bq, bar) {
      var r = document.createRange();
      var start = Array.prototype.indexOf.call(bq.childNodes, bar) + 1;
      r.setStart(bq, start);
      r.setEnd(bq, bq.childNodes.length);
      return r;
    }

    function selectRange(r) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return sel;
    }

    function flash(btn, label) {
      var orig = btn.getAttribute('data-label');
      btn.textContent = label;
      clearTimeout(btn.__enhT);
      btn.__enhT = setTimeout(function(){ btn.textContent = orig; }, 1200);
    }

    function copyQuote(bq, bar, btn) {
      var sel = selectRange(quoteRange(bq, bar));
      // Selection.toString() keeps line breaks between paragraphs and list items.
      var text = sel.toString().trim();
      function legacy() {
        var ok = false;
        try { ok = document.execCommand('copy'); } catch(_) {}
        sel.removeAllRanges();
        flash(btn, ok ? T.copied : T.copyFailed);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function(){
          sel.removeAllRanges();
          flash(btn, T.copied);
        }, legacy);
      } else {
        legacy();
      }
    }

    function makeBtn(bar, label, name, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'enh-qt-btn';
      b.textContent = label;
      b.setAttribute('data-label', label);
      b.setAttribute('aria-label', name);
      // Keep focus and any current selection untouched until the click runs.
      b.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        onClick(b);
      });
      bar.appendChild(b);
    }

    function attach(bq) {
      var bar = bq.querySelector(':scope > .enh-qt-bar');
      if (bar && bq.firstChild === bar) return;
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'enh-qt-bar';
        bar.contentEditable = 'false';
        makeBtn(bar, T.copy, T.copyQuote, function(btn){ copyQuote(bq, bar, btn); });
        makeBtn(bar, T.select, T.selectQuote, function(btn){
          selectRange(quoteRange(bq, bar));
          flash(btn, T.selected);
        });
      }
      // React may re-render content in front of the bar; keep it first.
      bq.insertBefore(bar, bq.firstChild);
    }

    function scan() {
      var list = document.querySelectorAll('blockquote');
      for (var i = 0; i < list.length; i++) {
        var bq = list[i];
        if (bq.isContentEditable || bq.closest('[contenteditable="true"], .enh-quote-tray')) continue;
        attach(bq);
      }
    }

    var pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      setTimeout(function(){ pending = false; try { scan(); } catch(_) {} }, 50);
    }

    function start() {
      scan();
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  } catch (_) {}
})();`
}

export const quoteToolsRecipe: Recipe = {
  id: 'quoteTools',
  // Verified on the pristine copies of these versions (the round trip; it has no anchors).
  apply (texts: FileTexts, options: RecipeOptions = DEFAULT_RECIPE_OPTIONS): FileTexts {
    const css = texts['webview/index.css']
    const js = texts['webview/index.js']
    if (css === undefined) throw new AnchorError('webview/index.css is missing')
    if (js === undefined) throw new AnchorError('webview/index.js is missing')
    return {
      'webview/index.css': appendBlock(css, QUOTE_TOOLS_CSS_BEGIN, QUOTE_TOOLS_CSS, QUOTE_TOOLS_CSS_END),
      // The leading ";" ends whatever statement the bundle's last line left open.
      'webview/index.js': appendBlock(js, `;${QUOTE_TOOLS_JS_BEGIN}`, quoteToolsScript(options.text), `;${QUOTE_TOOLS_JS_END}`),
    }
  },
  validate (_before, after) {
    const js = after['webview/index.js'] ?? ''
    const start = js.lastIndexOf(QUOTE_TOOLS_JS_BEGIN)
    if (start < 0) throw new Error('the quote tools script block is missing')
    new vm.Script(js.slice(start + QUOTE_TOOLS_JS_BEGIN.length, js.lastIndexOf(QUOTE_TOOLS_JS_END) - 1))
    const css = after['webview/index.css'] ?? ''
    if (!css.includes(QUOTE_TOOLS_CSS_BEGIN) || !css.includes(QUOTE_TOOLS_CSS_END)) throw new Error('the quote tools style block is missing')
  },
}
