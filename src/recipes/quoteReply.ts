// Quote reply: select text in a Claude reply and a Reply + Copy bar appears over it.
// Ported from the prototype's apply_quote_reply v3 (claude code injection,
// app/engine/injector-engine.sh:1711), the behaviour the owner field-tested:
// - Reply adds the selection as a card to a tray floating above the composer; several
//   cards stack, each removable with ×. Nothing is typed into the composer.
// - On send (Enter or form submit), a document-level capture listener (it runs before
//   React's root listener) puts the cards in front of the composer's text as "> " quote
//   lines, because Claude Code's submit handler reads the composer's text synchronously.
// - The cards clear only when the composer was emptied (the message was sent); otherwise
//   the added lines are taken back out and the cards stay, so a broken hook shows instead
//   of a quote silently vanishing.
// - Copy puts the selection on the clipboard and says Copied / Copy failed.
// Differences from the prototype: its own class prefix (enh-quote-) and no console log.
//
// Anchors: the chat's message class is the `message_<h>` sharing the hash of the single
// `chatContainer_<h>` class (seven `message_*` classes exist; the prototype took the
// first alphabetically and happened to be right). The composer is the single
// `messageInput_<h>` class.
import * as vm from 'vm'

import { AnchorError, DEFAULT_RECIPE_OPTIONS } from '../engine/recipe.ts'
import type { FileTexts, Recipe, RecipeOptions } from '../engine/recipe.ts'
import { en } from '../i18n/en.ts'
import type { Text } from '../i18n/en.ts'
import { appendBlock, classesNamed } from './shared.ts'

export const QUOTE_REPLY_CSS_BEGIN = '/* Enhancer QUOTEREPLY BEGIN */'
export const QUOTE_REPLY_CSS_END = '/* Enhancer QUOTEREPLY END */'
export const QUOTE_REPLY_JS_BEGIN = '/* Enhancer QUOTEREPLY Script BEGIN */'
export const QUOTE_REPLY_JS_END = '/* Enhancer QUOTEREPLY Script END */'

export type QuoteReplyClasses = ReturnType<typeof findQuoteReplyClasses>

export function findQuoteReplyClasses (css: string) {
  const containers = classesNamed(css, 'chatContainer')
  if (containers.length !== 1) throw new AnchorError(`chatContainer: ${containers.length} classes, expected exactly 1`)
  const message = `message_${containers[0].slice('chatContainer_'.length)}`
  if (!classesNamed(css, 'message').includes(message)) throw new AnchorError(`${message} not found beside ${containers[0]}`)
  const inputs = classesNamed(css, 'messageInput')
  if (inputs.length !== 1) throw new AnchorError(`messageInput: ${inputs.length} classes, expected exactly 1`)
  return { message, messageInput: inputs[0] }
}

export const QUOTE_REPLY_CSS = `.enh-quote-bar {
  position: fixed;
  direction: ltr;
  z-index: 99999;
  display: none;
  gap: 10px;
  user-select: none;
  -webkit-user-select: none;
}
.enh-quote-bar.enh-visible { display: inline-flex; }
.enh-quote-btn {
  padding: 8px 18px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  color: #fff;
  background: #2b2b2b;
  border: 1px solid #555;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  cursor: pointer;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  direction: ltr;
}
.enh-quote-btn svg { flex: none; display: block; }
.enh-quote-btn:hover { background: #3a3a3a; }
.enh-quote-tray {
  position: fixed;
  z-index: 9999;
  display: none;
  flex-direction: column;
  gap: 8px;
  max-height: 45vh;
  overflow-y: auto;
  padding: 10px;
  box-sizing: border-box;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-widget-border, #454545);
  border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
}
.enh-quote-tray.enh-visible { display: flex; }
.enh-quote-chip {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border-inline-start: 4px solid var(--vscode-textLink-foreground, #3794ff);
  border-radius: 6px;
  background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
}
.enh-quote-chip-text {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--vscode-foreground, #ddd);
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
}
.enh-quote-chip-x {
  flex: none;
  padding: 0 6px;
  font-size: 22px;
  line-height: 1;
  color: var(--vscode-descriptionForeground, #ccc);
  background: none;
  border: 0;
  cursor: pointer;
}
.enh-quote-chip-x:hover { color: var(--vscode-foreground, #fff); }`

export function quoteReplyScript (c: QuoteReplyClasses, text: Text = en) {
  return `;(function(){
  try {
    if (window.__enhancerQuoteReplyInstalled) return;
    window.__enhancerQuoteReplyInstalled = true;

    var T = ${JSON.stringify({ copy: text.c_copy, reply: text.c_reply, copied: text.c_copied, copyFailed: text.c_copyFailed, removeQuote: text.c_removeQuote })};
    var MSG_CLASS = ${JSON.stringify(c.message)};
    var INPUT_CLASS = ${JSON.stringify(c.messageInput)};

    // Selection toolbar: Copy on the left, Reply on the right, each with an icon.
    var bar = document.createElement('div');
    bar.className = 'enh-quote-bar';
    var SVG_OPEN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    var ICON_COPY = SVG_OPEN + '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
    var ICON_REPLY = SVG_OPEN + '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>';
    function makeBtn(label, iconSvg) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'enh-quote-btn';
      b.innerHTML = iconSvg;
      var t = document.createElement('span');
      t.className = 'enh-quote-label';
      t.textContent = label;
      b.appendChild(t);
      b.setAttribute('aria-label', label);
      bar.appendChild(b);
      return b;
    }
    var copyBtn = makeBtn(T.copy, ICON_COPY);
    var replyBtn = makeBtn(T.reply, ICON_REPLY);
    function setCopyLabel(s) { copyBtn.querySelector('.enh-quote-label').textContent = s; }

    // Quote tray: pending quotes shown as cards above the composer, attached on send.
    var tray = document.createElement('div');
    tray.className = 'enh-quote-tray';
    var quotes = [];
    var trayTimer = null;

    var lastText = '';
    var debounceId = null;

    function findMessageAncestor(node) {
      while (node && node !== document.body) {
        if (node.nodeType === 1 && node.classList && node.classList.contains(MSG_CLASS)) return node;
        node = node.parentNode;
      }
      return null;
    }

    function hideBar() {
      bar.classList.remove('enh-visible');
    }

    function onSelectionChange() {
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(handleSelection, 120);
    }

    function handleSelection() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideBar(); return; }
      var text = sel.toString().trim();
      if (!text) { hideBar(); return; }
      var anchorEl = sel.anchorNode && sel.anchorNode.nodeType === 1
        ? sel.anchorNode
        : (sel.anchorNode && sel.anchorNode.parentNode);
      if (!findMessageAncestor(anchorEl)) { hideBar(); return; }
      var range = sel.getRangeAt(sel.rangeCount - 1);
      var rect = range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) { hideBar(); return; }
      lastText = text;
      setCopyLabel(T.copy);
      var top = Math.max(8, rect.top - 48);
      var left = Math.min(window.innerWidth - 240, rect.right - 220);
      bar.style.top = top + 'px';
      bar.style.left = Math.max(8, left) + 'px';
      bar.classList.add('enh-visible');
    }

    function findComposer() {
      return document.querySelector('.' + INPUT_CLASS + '[contenteditable]')
        || document.querySelector('[role="textbox"][contenteditable]');
    }

    function quoteBlock(list) {
      return list.map(function(q){
        return q.split('\\n').map(function(l){ return '> ' + l; }).join('\\n');
      }).join('\\n\\n') + '\\n\\n';
    }

    function positionTray() {
      var c = findComposer();
      var form = c && (c.closest('form') || c.parentNode);
      if (!form) { tray.classList.remove('enh-visible'); return; }
      var r = form.getBoundingClientRect();
      if (!r.width) { tray.classList.remove('enh-visible'); return; }
      tray.style.left = r.left + 'px';
      tray.style.width = r.width + 'px';
      tray.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      tray.classList.add('enh-visible');
    }

    function renderTray() {
      tray.textContent = '';
      quotes.forEach(function(q, i){
        var chip = document.createElement('div');
        chip.className = 'enh-quote-chip';
        var t = document.createElement('div');
        t.className = 'enh-quote-chip-text';
        t.setAttribute('dir', 'auto');
        t.textContent = q;
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'enh-quote-chip-x';
        x.textContent = '×';
        x.title = T.removeQuote;
        x.setAttribute('aria-label', T.removeQuote);
        x.addEventListener('mousedown', function(e){ e.preventDefault(); });
        x.addEventListener('click', function(e){
          e.preventDefault(); e.stopPropagation();
          quotes.splice(i, 1);
          renderTray();
        });
        chip.appendChild(t);
        chip.appendChild(x);
        tray.appendChild(chip);
      });
      if (quotes.length) {
        positionTray();
        if (!trayTimer) trayTimer = setInterval(positionTray, 250);
      } else {
        tray.classList.remove('enh-visible');
        if (trayTimer) { clearInterval(trayTimer); trayTimer = null; }
      }
    }

    function focusComposerEnd(c) {
      try { c.focus(); } catch(_) {}
      try {
        var r = document.createRange();
        r.selectNodeContents(c);
        r.collapse(false);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      } catch(_) {}
    }

    // Fallback when the composer has no form: put the quote in as plain text.
    function insertQuoteText(c, text) {
      focusComposerEnd(c);
      try { document.execCommand('insertText', false, text); return true; } catch(_) { return false; }
    }

    // Takes \`prefix\` off the start of the composer's text, across however many text
    // nodes it now spans (React may have rebuilt them), leaving the rest as it is.
    function removeLeading(root, prefix) {
      if ((root.textContent || '').indexOf(prefix) !== 0) return;
      var left = prefix.length, n, emptied = [];
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (left > 0 && (n = walker.nextNode())) {
        var take = Math.min(left, n.data.length);
        n.data = n.data.slice(take);
        left -= take;
        if (!n.data) emptied.push(n);
      }
      emptied.forEach(function(e){ if (e.parentNode) e.parentNode.removeChild(e); });
    }

    // Prepends the pending quotes to the composer just before Claude Code reads it.
    // Success = the composer was cleared; anything else rolls the prefix back and keeps
    // the cards, so a broken hook stays visible instead of dropping the quote. One send
    // attempt at a time: an Enter that also submits the form must not attach twice.
    var attaching = false;
    function attachQuotes(composer) {
      if (!quotes.length || attaching) return;
      attaching = true;
      var prefix = quoteBlock(quotes);
      composer.insertBefore(document.createTextNode(prefix), composer.firstChild);
      setTimeout(function(){
        attaching = false;
        var current = findComposer() || composer;
        if ((current.textContent || '').trim() === '') {
          quotes = [];
          renderTray();
          return;
        }
        removeLeading(current, prefix);
      }, 50);
    }

    document.addEventListener('keydown', function(e){
      if (!quotes.length || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
      var c = findComposer();
      if (!c || e.target !== c) return;
      attachQuotes(c);
    }, true);

    document.addEventListener('submit', function(e){
      if (!quotes.length) return;
      var c = findComposer();
      if (!c || !e.target || !e.target.contains || !e.target.contains(c)) return;
      attachQuotes(c);
    }, true);

    bar.addEventListener('mousedown', function(e){
      e.preventDefault();
      e.stopPropagation();
    }, true);

    replyBtn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      var text = lastText;
      if (!text) { hideBar(); return; }
      lastText = '';
      hideBar();
      var c = findComposer();
      if (!c) return;
      if (!c.closest('form')) {
        insertQuoteText(c, quoteBlock([text]));
        return;
      }
      quotes.push(text);
      renderTray();
      setTimeout(function(){ focusComposerEnd(c); }, 0);
    }, true);

    copyBtn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      var text = lastText;
      if (!text) { hideBar(); return; }
      function done(ok) {
        setCopyLabel(ok ? T.copied : T.copyFailed);
        setTimeout(hideBar, 700);
      }
      function legacy() {
        var ok = false;
        try { ok = document.execCommand('copy'); } catch(_) {}
        done(ok);
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function(){ done(true); }, legacy);
        } else legacy();
      } catch(_) { legacy(); }
    }, true);

    function start() {
      document.body.appendChild(bar);
      document.body.appendChild(tray);
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('scroll', hideBar, true);
      window.addEventListener('resize', function(){ hideBar(); if (quotes.length) positionTray(); });
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  } catch (_) {}
})();`
}

export const quoteReplyRecipe: Recipe = {
  id: 'quoteReply',
  // Verified on the pristine copies of these versions (anchors and the round trip).
  apply (texts: FileTexts, options: RecipeOptions = DEFAULT_RECIPE_OPTIONS): FileTexts {
    const css = texts['webview/index.css']
    const js = texts['webview/index.js']
    if (css === undefined) throw new AnchorError('webview/index.css is missing')
    if (js === undefined) throw new AnchorError('webview/index.js is missing')
    const classes = findQuoteReplyClasses(css)
    return {
      'webview/index.css': appendBlock(css, QUOTE_REPLY_CSS_BEGIN, QUOTE_REPLY_CSS, QUOTE_REPLY_CSS_END),
      // The leading ";" ends whatever statement the bundle's last line left open.
      'webview/index.js': appendBlock(js, `;${QUOTE_REPLY_JS_BEGIN}`, quoteReplyScript(classes, options.text), `;${QUOTE_REPLY_JS_END}`),
    }
  },
  validate (_before, after) {
    const js = after['webview/index.js'] ?? ''
    const start = js.lastIndexOf(QUOTE_REPLY_JS_BEGIN)
    if (start < 0) throw new Error('the quote reply script block is missing')
    new vm.Script(js.slice(start + QUOTE_REPLY_JS_BEGIN.length, js.lastIndexOf(QUOTE_REPLY_JS_END) - 1))
    const css = after['webview/index.css'] ?? ''
    if (!css.includes(QUOTE_REPLY_CSS_BEGIN) || !css.includes(QUOTE_REPLY_CSS_END)) throw new Error('the quote reply style block is missing')
  },
}
