// Right-to-left wins (owner rule, 2026-10-02; widened 2026-10-18 from Arabic to every
// right-to-left script): any chat text holding at least one letter of a right-to-left
// script reads right to left and is right-aligned, even when it opens with an English
// word; text with no such letter stays left to right. Ported from the prototype's apply_rtl
// (claude code injection, app/engine/injector-engine.sh:384): the same CSS rules and the
// same "RTL Arabic Wins" script, with stricter anchors.
//
// Anchors: Claude Code's webview CSS uses hashed class names (`message_07S1Yg`). Seven
// different `message_*` classes exist (one per component), so the chat's message class
// is the one that shares the hash of the single `chatContainer_*` class. Every other
// class must appear at most once; a second distinct match is ambiguous and fails the
// recipe instead of guessing.
import * as vm from 'vm'

import { AnchorError } from '../engine/recipe.ts'
import type { FileTexts, Recipe } from '../engine/recipe.ts'
import { appendBlock, classesNamed } from './shared.ts'

export const RTL_CSS_BEGIN = '/* Enhancer RTL BEGIN */'
export const RTL_CSS_END = '/* Enhancer RTL END */'
export const RTL_JS_BEGIN = '/* Enhancer RTL Script BEGIN */'
export const RTL_JS_END = '/* Enhancer RTL Script END */'

/** A regex (flag `u`) matching one letter of a right-to-left script: Hebrew, Arabic (with
 * Persian and Urdu), Syriac, Thaana, N'Ko, Samaritan, Mandaic, Adlam and Hanifi Rohingya,
 * presentation forms and letters beyond U+FFFF included. Letters only: their digits,
 * punctuation, signs and lone marks do not turn text (review rv-00b4ec38). Kept as source
 * text so the injected script can embed it. */
export const RTL_LETTER_PATTERN = '(?=\\p{L})[\\p{Script=Hebrew}\\p{Script=Arabic}\\p{Script=Syriac}\\p{Script=Thaana}\\p{Script=Nko}' +
  '\\p{Script=Samaritan}\\p{Script=Mandaic}\\p{Script=Adlam}\\p{Script=Hanifi_Rohingya}]'

const LINE_HEIGHT = '2'
const INPUT_PADDING = '10px 44px 10px 20px'

/** The one class with this name, or undefined when absent. Throws when ambiguous. */
function optionalClass (css: string, name: string) {
  const found = classesNamed(css, name)
  if (found.length > 1) throw new AnchorError(`${name}: ${found.length} different classes, expected at most 1`)
  return found[0]
}

export type RtlClasses = ReturnType<typeof findRtlClasses>

export function findRtlClasses (css: string) {
  const containers = classesNamed(css, 'chatContainer')
  if (containers.length !== 1) throw new AnchorError(`chatContainer: ${containers.length} classes, expected exactly 1`)
  const hash = containers[0].slice('chatContainer_'.length)
  const sameModule = (name: string) => {
    const cls = `${name}_${hash}`
    if (!classesNamed(css, name).includes(cls)) throw new AnchorError(`${cls} not found beside ${containers[0]}`)
    return cls
  }
  return {
    chatContainer: containers[0],
    message: sameModule('message'),
    userMessage: sameModule('userMessage'),
    userMessageContainer: optionalClass(css, 'userMessageContainer'),
    messageInput: optionalClass(css, 'messageInput'),
    mentionMirror: optionalClass(css, 'mentionMirror'),
    todoItem: optionalClass(css, 'todoItem'),
    questionText: optionalClass(css, 'questionText'),
    questionTextLarge: optionalClass(css, 'questionTextLarge'),
    optionLabel: optionalClass(css, 'optionLabel'),
    optionDescription: optionalClass(css, 'optionDescription'),
    optionText: optionalClass(css, 'optionText'),
    questionsContainer: optionalClass(css, 'questionsContainer'),
    questionBlock: optionalClass(css, 'questionBlock'),
    questionHeader: optionalClass(css, 'questionHeader'),
    questionItem: optionalClass(css, 'questionItem'),
    optionsContainer: optionalClass(css, 'optionsContainer'),
    option: optionalClass(css, 'option'),
    optionContent: optionalClass(css, 'optionContent'),
    navTabLabel: optionalClass(css, 'navTabLabel'),
    permissionRequestContent: optionalClass(css, 'permissionRequestContent'),
    permissionRequestHeader: optionalClass(css, 'permissionRequestHeader'),
    permissionRequestDescription: optionalClass(css, 'permissionRequestDescription'),
    otherInput: optionalClass(css, 'otherInput'),
  }
}

/** `.a<suffix>,\n.b<suffix>` for the classes that exist; a missing one is skipped, never a bare ".". */
const selectors = (suffix: string, ...classes: (string | undefined)[]) =>
  classes.filter((c): c is string => !!c).map(c => `.${c}${suffix}`).join(',\n')

export function rtlCss (c: RtlClasses) {
  // A question part holding an Arabic letter (tagged by the script) mirrors its flex
  // layout. The Other answer box is excluded: typing Arabic there must not flip an
  // English question.
  const arabicPart = ':has([data-cc-dir="rtl"]:not([contenteditable]))'
  const messageSel = selectors('', c.message, c.userMessage, c.userMessageContainer)
  const inputSel = selectors('', c.messageInput, c.mentionMirror)
  const questionTextSel = selectors('',
    c.questionsContainer, c.questionBlock, c.questionHeader, c.questionItem, c.questionText,
    c.questionTextLarge, c.optionsContainer, c.option, c.optionContent, c.optionLabel,
    c.optionDescription, c.optionText, c.navTabLabel, c.permissionRequestHeader, c.permissionRequestDescription)
  const questionFlipSel = selectors(arabicPart,
    c.questionBlock, c.questionHeader, c.questionItem, c.optionsContainer, c.option, c.optionContent)
  const questionArabicClasses = [c.questionHeader, c.questionText, c.questionTextLarge, c.optionLabel,
    c.optionDescription, c.optionText, c.navTabLabel, c.permissionRequestHeader, c.permissionRequestDescription]
  const questionArabicRtlSel = [
    selectors('[data-cc-dir="rtl"]', ...questionArabicClasses),
    c.otherInput ? `.${c.otherInput} [contenteditable][data-cc-dir="rtl"]` : '',
  ].filter(Boolean).join(',\n')

  const blocks: string[] = []
  blocks.push(`${messageSel} {
  unicode-bidi: plaintext;
  text-align: start;
}
.${c.message} p,
.${c.message} li,
.${c.message} h1,
.${c.message} h2,
.${c.message} h3,
.${c.message} h4,
.${c.message} h5,
.${c.message} h6,
.${c.message} blockquote,
.${c.userMessage} p,
.${c.userMessage} li {
  unicode-bidi: plaintext;
  text-align: start;
}

/* Tables inside messages are always RTL: cells do not inherit a resolved direction, so
   :dir(rtl) never matches. The auto left margin pins a shrink-to-fit table right. */
.${c.message} table,
.${c.userMessage} table {
  direction: rtl;
  margin-left: auto;
  margin-right: 0;
}
.${c.message} th,
.${c.message} td,
.${c.userMessage} th,
.${c.userMessage} td {
  unicode-bidi: plaintext;
  text-align: right;
}

/* Arabic wins in mixed text: plaintext follows the FIRST strong letter, so an Arabic
   sentence opening with an English word would read LTR and scrambled. The script tags
   every block holding an Arabic letter with data-cc-dir="rtl"; these rules force it. */
.${c.message} [data-cc-dir="rtl"],
.${c.userMessage}[data-cc-dir="rtl"],
.${c.userMessage} [data-cc-dir="rtl"] {
  direction: rtl;
  unicode-bidi: isolate;
  text-align: right;
}
.${c.message} [data-cc-dir="rtl"] li,
.${c.message} [data-cc-dir="rtl"] p {
  text-align: right;
}`)

  if (inputSel) {
    blocks.push(`/* Compose box: the input text is transparent and the mirror draws the visible
   glyphs, so both share the same rules or caret and text diverge. */
${inputSel} {
  unicode-bidi: plaintext;
  text-align: start;
  padding: ${INPUT_PADDING};
}`)
  }

  if (c.todoItem) {
    const todoContent = `content_${c.todoItem.slice('todoItem_'.length)}`
    blocks.push(`/* Todo checklist: mirrored always; each item auto-bidis on its own. */
.${c.todoItem} {
  direction: rtl;
}
.${todoContent} {
  unicode-bidi: plaintext;
  text-align: start;
}`)
  }

  blocks.push(`/* Line spacing: Arabic diacritics read cramped at 1.5. Code stays tight. */
.${c.chatContainer} {
  line-height: ${LINE_HEIGHT};
}
.${c.chatContainer} pre,
.${c.chatContainer} code {
  line-height: 1.5;
}`)

  if (questionTextSel) {
    blocks.push(`/* AskUserQuestion and the permission dialog: auto bidi for text. */
${questionTextSel} {
  unicode-bidi: plaintext;
  text-align: start;
}`)
  }

  if (questionArabicRtlSel) {
    const otherBox = c.otherInput
      ? `.${c.otherInput} [contenteditable],
.${c.otherInput} > [aria-hidden="true"] {
  unicode-bidi: plaintext;
  text-align: start;
}
`
      : ''
    blocks.push(`/* AskUserQuestion: Arabic wins, decided per element by the script. */
${otherBox}${questionArabicRtlSel} {
  direction: rtl;
  unicode-bidi: isolate;
  text-align: right;
}`)
  }

  if (questionFlipSel) {
    blocks.push(`/* AskUserQuestion: flip the flex layout when Arabic is present. */
${questionFlipSel} {
  direction: rtl;
}`)
  }

  if (c.permissionRequestContent && c.questionsContainer) {
    blocks.push(`/* The question box sits inside the permission container: mirroring it mirrors the
   whole card, only for question cards holding Arabic (Bash yes/no prompts stay LTR). */
.${c.permissionRequestContent}:has(.${c.questionsContainer})${arabicPart} {
  direction: rtl;
}`)
  }

  return blocks.join('\n\n')
}

export function rtlScript (c: RtlClasses) {
  const questionTextSel = [c.questionHeader, c.questionText, c.questionTextLarge, c.optionLabel,
    c.optionDescription, c.optionText, c.navTabLabel, c.permissionRequestHeader, c.permissionRequestDescription]
    .filter(Boolean).map(x => `.${x}`)
    .concat(c.otherInput ? [`.${c.otherInput} [contenteditable]`] : [])
    .join(', ')
  const questionScopeSel = [c.permissionRequestContent, c.questionBlock].filter(Boolean).map(x => `.${x}`).join(', ')

  return `;(function(){
  try {
    if (window.__enhancerRtlInstalled) return;
    window.__enhancerRtlInstalled = true;

    var MSG_CLASS = ${JSON.stringify(c.message)};
    var USER_MSG_CLASS = ${JSON.stringify(c.userMessage)};
    var SCOPE_SEL = '.' + MSG_CLASS + ', .' + USER_MSG_CLASS;
    var BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,ul,ol';
    var RTL_LETTER = new RegExp(${JSON.stringify(RTL_LETTER_PATTERN)}, 'u');
    // Nested blocks decide for themselves: a list item must not flip because of a
    // right-to-left sub-list or a code block under it.
    var NESTED_BLOCK_TAGS = { UL: 1, OL: 1, PRE: 1, TABLE: 1 };
    var QUESTION_TEXT_SEL = ${JSON.stringify(questionTextSel)};
    var QUESTION_SCOPE_SEL = ${JSON.stringify(questionScopeSel)};
    var questionDirty = false;

    function ownText(el) {
      if (el.tagName === 'UL' || el.tagName === 'OL') return el.textContent || '';
      var text = '';
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) text += n.nodeValue;
        else if (n.nodeType === 1 && !NESTED_BLOCK_TAGS[n.tagName]) text += n.textContent || '';
      }
      return text;
    }

    function markDirection(el) {
      var wantRtl = RTL_LETTER.test(ownText(el));
      var isRtl = el.getAttribute('data-cc-dir') === 'rtl';
      if (wantRtl && !isRtl) el.setAttribute('data-cc-dir', 'rtl');
      else if (!wantRtl && isRtl) el.removeAttribute('data-cc-dir');
    }

    function markScope(scope) {
      if (!scope.isConnected) return;
      if (scope.classList.contains(USER_MSG_CLASS)) markDirection(scope);
      var blocks = scope.querySelectorAll(BLOCK_SEL + ', .' + USER_MSG_CLASS);
      for (var i = 0; i < blocks.length; i++) markDirection(blocks[i]);
    }

    // Elements wrapping code, JSON details or another editor keep plaintext: forcing
    // RTL there reorders code.
    function markQuestionText(el) {
      var wantRtl = (el.isContentEditable || !el.querySelector('pre,code,details,[contenteditable]'))
        && RTL_LETTER.test(el.textContent || '');
      var isRtl = el.getAttribute('data-cc-dir') === 'rtl';
      if (wantRtl && !isRtl) el.setAttribute('data-cc-dir', 'rtl');
      else if (!wantRtl && isRtl) el.removeAttribute('data-cc-dir');
    }

    var pendingScopes = new Set();
    var frameQueued = false;
    function flush() {
      frameQueued = false;
      var scopes = Array.from(pendingScopes);
      pendingScopes.clear();
      for (var i = 0; i < scopes.length; i++) {
        try { markScope(scopes[i]); } catch (e) {}
      }
      if (questionDirty) {
        questionDirty = false;
        try {
          var texts = document.querySelectorAll(QUESTION_TEXT_SEL);
          for (var j = 0; j < texts.length; j++) markQuestionText(texts[j]);
        } catch (e) {}
      }
    }
    function queueFlush() {
      if (!frameQueued) { frameQueued = true; requestAnimationFrame(flush); }
    }
    function queueScope(scope) {
      pendingScopes.add(scope);
      queueFlush();
    }
    // searchInside: also look for messages below node; only for added nodes and the
    // first pass, so a mutation on the chat list never rescans every message.
    function queueFrom(node, searchInside) {
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (!el) return;
      if (QUESTION_TEXT_SEL && QUESTION_SCOPE_SEL && !questionDirty
          && (el.closest(QUESTION_SCOPE_SEL)
              || (searchInside && node.nodeType === 1 && el.querySelector(QUESTION_SCOPE_SEL)))) {
        questionDirty = true;
        queueFlush();
      }
      var scope = el.closest(SCOPE_SEL);
      if (scope) { queueScope(scope); return; }
      if (searchInside && node.nodeType === 1) {
        var inner = el.querySelectorAll(SCOPE_SEL);
        for (var i = 0; i < inner.length; i++) queueScope(inner[i]);
      }
    }

    function start() {
      queueFrom(document.body, true);
      new MutationObserver(function(records) {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          queueFrom(r.target, false);
          for (var j = 0; j < r.addedNodes.length; j++) queueFrom(r.addedNodes[j], true);
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  } catch (e) {}
})();`
}

export const rtlRecipe: Recipe = {
  id: 'rtl',
  // Verified on the pristine copies of these versions (anchors and the round trip).
  apply (texts: FileTexts): FileTexts {
    const css = texts['webview/index.css']
    const js = texts['webview/index.js']
    if (css === undefined) throw new AnchorError('webview/index.css is missing')
    if (js === undefined) throw new AnchorError('webview/index.js is missing')
    const classes = findRtlClasses(css)
    return {
      'webview/index.css': appendBlock(css, RTL_CSS_BEGIN, rtlCss(classes), RTL_CSS_END),
      // The leading ";" ends whatever statement the bundle's last line left open.
      'webview/index.js': appendBlock(js, `;${RTL_JS_BEGIN}`, rtlScript(classes), `;${RTL_JS_END}`),
    }
  },
  validate (_before, after) {
    const js = after['webview/index.js'] ?? ''
    const start = js.lastIndexOf(RTL_JS_BEGIN)
    if (start < 0) throw new Error('the Arabic script block is missing')
    // The injected script must parse on its own; the bundle around it is untouched.
    new vm.Script(js.slice(start + RTL_JS_BEGIN.length, js.lastIndexOf(RTL_JS_END) - 1))
    const css = after['webview/index.css'] ?? ''
    if (!css.includes(RTL_CSS_BEGIN) || !css.includes(RTL_CSS_END)) throw new Error('the Arabic style block is missing')
    // Comments removed first: prose may hold a lone ".". What remains must have no empty
    // class selector ("." before a space, comma or brace) and no "undefined" class.
    const rules = css.slice(css.lastIndexOf(RTL_CSS_BEGIN) + RTL_CSS_BEGIN.length).replace(/\/\*[\s\S]*?\*\//g, '')
    if (/\.(?=[\s,{])|\.undefined\b/.test(rules)) throw new Error('an empty selector slipped into the style block')
  },
}
