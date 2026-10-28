// Image preview: thumbnails of the image files a tool row touches (Claude reads, writes or
// names a .png/.jpg/…), under that row in the chat; a click zooms, a corner button opens the
// file in the editor. Ported from the prototype's apply_image_preview (claude code injection,
// app/engine/injector-engine.sh:1087), the behaviour the owner field-tested:
// - The tool-body renderer gets a guard in front of its own return: when the call's input
//   (file_path, path, image_path, …) or its result text names image files (at most 4),
//   the body is returned wrapped together with an empty strip holding the paths.
// - The webview script fills each strip: it asks the extension host for the file
//   (`enhImgRead`), shows a shimmer while waiting, then the thumbnail; the answer is cached
//   per path for re-renders. Errors show "Preview unavailable" / "Image too large to preview".
// - The host side (appended to extension.js) reads only image files, at most 16 MB: the
//   name and the real file behind any link must have an image extension, and the first
//   bytes must match that kind (review rv-72c52030 R1),
//   resolves `~` and workspace-relative paths, and answers with a data URI. The webview
//   keeps successful reads only, per tool call and path (at most 40), so an image a tool
//   creates or saves again is read afresh (R2, R4, R5), and strips React updates in place
//   are filled again (R3). `enhImgOpen`
//   opens the file with the editor's own viewer. Our two message types are routed before
//   Claude Code's own dispatcher in every webview it creates.
// - Claude Code's openFile sends every path to the text editor, which cannot show a binary;
//   images now go to the editor's own viewer (optional anchor: without it, only clicking an
//   image's file name keeps the old behaviour).
// - The webview can call acquireVsCodeApi() only once, so a shim prepended to the bundle
//   keeps the object Claude Code gets for our script too.
// Differences from the prototype: own class prefix (enh-img-) and message names, no console
// logging, and Windows drive paths (C:\…) are also found in result text.
//
// Anchors (each must match as described, else the feature fails alone):
// - webview/index.js: the tool-row renderer `return <jsxs>("div",{className:<m>.root,children:
//   [<jsx>("summary",{className:<m>.toolSummary` (exactly once) gives the jsx helpers; the
//   tool-body function `function f(msg,toolUse,ctx[,card]){return lookup(toolUse.name,ctx)
//   .body(ctx,toolUse.input,<result>,msg.progress.value[,{…}])}` (exactly once).
// - extension.js: `<host>.webview.onDidReceiveMessage((<arg>)=>{` followed by Claude Code's
//   logging + `fromClient` (at least once; every match is routed).
import * as vm from 'vm'

import { AnchorError, DEFAULT_RECIPE_OPTIONS } from '../engine/recipe.ts'
import type { FileTexts, Recipe, RecipeOptions } from '../engine/recipe.ts'
import { en } from '../i18n/en.ts'
import type { Text } from '../i18n/en.ts'
import { appendBlock } from './shared.ts'
import { lineEndingOf } from '../engine/files.ts'

export const IMAGE_CSS_BEGIN = '/* Enhancer IMAGEPREVIEW BEGIN */'
export const IMAGE_CSS_END = '/* Enhancer IMAGEPREVIEW END */'
export const IMAGE_JS_BEGIN = '/* Enhancer IMAGEPREVIEW Script BEGIN */'
export const IMAGE_JS_END = '/* Enhancer IMAGEPREVIEW Script END */'
export const IMAGE_SHIM_BEGIN = '/* Enhancer IMAGEPREVIEW Shim BEGIN */'
export const IMAGE_SHIM_END = '/* Enhancer IMAGEPREVIEW Shim END */'
export const IMAGE_HOST_BEGIN = '/* Enhancer IMAGEPREVIEW Host BEGIN */'
export const IMAGE_HOST_END = '/* Enhancer IMAGEPREVIEW Host END */'
export const IMAGE_GUARD_OPEN = '/*ENH-IMG{*/'
export const IMAGE_GUARD_CLOSE = '/*}ENH-IMG*/'
export const IMAGE_IPC_OPEN = '/*ENH-IMG-IPC*/'
export const IMAGE_IPC_CLOSE = '/*ENH-IMG-IPC-END*/'
export const IMAGE_OPEN_OPEN = '/*ENH-IMG-OPEN*/'
export const IMAGE_OPEN_CLOSE = '/*ENH-IMG-OPEN-END*/'

const JSX_ALIASES = /return ([\w$]+)\("div",\{className:([\w$]+)\.root,children:\[([\w$]+)\("summary",\{className:\2\.toolSummary/g

// 2.1.300+ adds a 4th parameter (engineCard) and picks the result as
// `X===void 0?msg.toolResult.value:X.result`; 2.1.285+ appends an options object. Both
// shapes are captured and replayed verbatim.
const TOOL_BODY = /function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)((?:,[\w$]+)?)\)\{return ([\w$]+)\(\3\.name,\4\)\.body\(\4,\3\.input,((?:[\w$]+===void 0\?)?\2\.toolResult\.value(?::[\w$]+\.result)?),\2\.progress\.value((?:,\{[^{}]*\})?)\)\}/g

const HOST_IPC = /([\w$]+)\.webview\.onDidReceiveMessage\(\(([\w$]+)\)=>\{(?=[\w$]+\(this\.output,\2\),[\w$]+\?\.fromClient\(\2\))/g

const OPEN_FILE = /(\{if\(([\w$]+)\.statSync\(([\w$]+)\)\.isDirectory\(\)\)\{([\w$]+)\.commands\.executeCommand\("revealInExplorer",([\w$]+)\);return\}\}catch\{[^{}]*\})/g

export const IMAGE_SHIM = `;(function(){var o=window.acquireVsCodeApi;if(typeof o!=="function")return;var c;window.acquireVsCodeApi=function(){if(!c){c=o.apply(this,arguments);window.__enhancerVsCodeApi=c;}return c;};})();`

export const IMAGE_CSS = `.enh-img-strip { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }
.enh-img-tile {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 60px;
  max-width: 100%;
  height: 120px;
  border: 1px solid var(--app-input-border, rgba(127,127,127,0.25));
  border-radius: 8px;
  overflow: hidden;
  background: var(--app-input-background, rgba(127,127,127,0.06));
  cursor: zoom-in;
  transition: border-color 0.12s ease;
}
.enh-img-tile:hover { border-color: var(--app-focus-border, rgba(127,127,127,0.55)); }
.enh-img-tile.is-loading {
  width: 160px;
  background-image: linear-gradient(90deg, rgba(127,127,127,0.05) 25%, rgba(127,127,127,0.16) 37%, rgba(127,127,127,0.05) 63%);
  background-size: 400% 100%;
  animation: enh-img-shimmer 1.3s ease-in-out infinite;
}
@keyframes enh-img-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
@media (prefers-reduced-motion: reduce) { .enh-img-tile.is-loading { animation: none; } }
.enh-img-thumb { display: block; height: 100%; width: auto; max-width: 260px; object-fit: cover; -webkit-user-drag: none; }
.enh-img-tile.is-error { width: auto; min-width: 0; height: auto; padding: 6px 10px; cursor: pointer; border-style: dashed; }
.enh-img-errtext { font-size: 11px; opacity: 0.7; color: var(--app-secondary-foreground, #888); }
.enh-img-openbtn {
  position: absolute;
  top: 5px;
  inset-inline-end: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}
.enh-img-tile:hover .enh-img-openbtn { opacity: 1; }
.enh-img-openbtn:hover { background: rgba(0,0,0,0.82); }
.enh-img-openbtn:focus-visible { opacity: 1; outline: 1px solid #fff; }
.enh-img-openbtn svg { display: block; pointer-events: none; }
.enh-img-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(2px);
  opacity: 0;
  transition: opacity 0.12s ease;
  cursor: zoom-out;
}
.enh-img-overlay.is-open { opacity: 1; }
.enh-img-overlaybox { position: relative; display: flex; flex-direction: column; gap: 8px; max-width: 100%; max-height: 100%; cursor: default; }
.enh-img-full { display: block; max-width: 92vw; max-height: 82vh; width: auto; height: auto; border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,0.45); }
.enh-img-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.enh-img-barbtn {
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.6;
  color: #fff;
  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.enh-img-barbtn:hover { background: rgba(255,255,255,0.26); }
.enh-img-close { width: 28px; padding: 4px 0; text-align: center; }`

export function imageScript (text: Text = en) {
  return `;(function(){
  try {
  if (window.__enhancerImageInstalled) return;
  window.__enhancerImageInstalled = true;

  var T_OPEN = ${JSON.stringify(text.c_openOnDisk)};
  var T_ZOOM = ${JSON.stringify(text.c_zoom)};
  var T_CLOSE = ${JSON.stringify(text.c_close)};
  var T_ERR = ${JSON.stringify(text.c_previewUnavailable)};
  var T_TOOBIG = ${JSON.stringify(text.c_imageTooLarge)};

  var IMG_RE = /\\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;
  var TEXT_PATH_RE = /(?:^|[\\s"'\`(=,])((?:~|\\/|[A-Za-z]:[\\\\\\/])[^\\s"'\`,;:)\\]}]+\\.(?:png|jpe?g|gif|webp|bmp|avif|ico|svg))/gi;
  var PATH_KEYS = ["file_path","filePath","path","notebook_path","image_path","imagePath","saveTo","outputFile","output","screenshot"];
  var MAX_PER_ROW = 4;

  // Successful reads only, per tool call, its state (running / done) and path: a later call
  // naming the same path (a screenshot saved again) and the same call once it finished read
  // the file afresh, and an error is asked again on the next try.
  var cache = new Map();   // scope + "#" + path -> {dataUri}
  var CACHE_MAX = 40;
  var pending = new Map(); // request id -> {key, path, tile}
  var seq = 0;

  function api(){
    var a = window.__enhancerVsCodeApi;
    if (!a && typeof window.acquireVsCodeApi === "function") {
      try { a = window.acquireVsCodeApi(); } catch (e) {}
    }
    return a || null;
  }

  function pushPath(list, p){
    if (typeof p !== "string") return;
    p = p.trim();
    if (!p || !IMG_RE.test(p)) return;
    if (list.indexOf(p) === -1 && list.length < MAX_PER_ROW) list.push(p);
  }

  function collectPaths(toolUse, result){
    var out = [];
    try {
      var input = (toolUse && toolUse.input) || {};
      for (var i = 0; i < PATH_KEYS.length; i++) pushPath(out, input[PATH_KEYS[i]]);
      if (Array.isArray(input.fileReads)) {
        for (var j = 0; j < input.fileReads.length; j++) {
          var fr = input.fileReads[j];
          pushPath(out, fr && (fr.file_path || fr.filePath || fr.path));
        }
      }
      if (out.length < MAX_PER_ROW && result) {
        var txt = typeof result === "string" ? result : (typeof result.content === "string" ? result.content : "");
        if (!txt && result.content && Array.isArray(result.content)) {
          txt = result.content.map(function(c){ return (c && typeof c.text === "string") ? c.text : ""; }).join("\\n");
        }
        if (txt) {
          TEXT_PATH_RE.lastIndex = 0;
          var m;
          while ((m = TEXT_PATH_RE.exec(txt)) && out.length < MAX_PER_ROW) pushPath(out, m[1]);
        }
      }
    } catch (e) {}
    return out;
  }

  // Called from the wrapped tool-body renderer, inside React's render pass.
  window.__enhancerImageBody = function(toolUse, result, orig, jsx, jsxs){
    try {
      var paths = collectPaths(toolUse, result);
      if (!paths.length) return orig;
      // data-enh-key changes when the call gets its result, so the strip is filled again
      // (an image the tool creates does not exist before it ran).
      var key = String((toolUse && toolUse.id) || "") + "|" + (result == null ? "0" : "1");
      var strip = jsx("div", { className: "enh-img-strip", "data-enh-imgs": JSON.stringify(paths), "data-enh-key": key });
      if (!orig) return strip;
      return jsxs("div", { className: "enh-img-wrap", children: [orig, strip] });
    } catch (e) {
      return orig;
    }
  };

  function requestImage(path, tile, scope){
    var key = scope + "#" + path;
    var hit = cache.get(key);
    if (hit) { paint(tile, path, hit); return; }
    var a = api();
    if (!a) { paint(tile, path, { error: "no-ipc" }); return; }
    var id = "enhimg-" + (++seq);
    pending.set(id, { key: key, path: path, tile: tile });
    try { a.postMessage({ type: "enhImgRead", id: id, path: path }); }
    catch (e) { pending.delete(id); paint(tile, path, { error: "no-ipc" }); }
  }

  window.addEventListener("message", function(ev){
    var d = ev && ev.data;
    if (!d || d.type !== "enhImgData") return;
    var p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    var entry = d.ok ? { dataUri: d.dataUri } : { error: d.error || "read-failed" };
    if (d.ok) {
      cache.delete(p.key);
      cache.set(p.key, entry);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    }
    paint(p.tile, p.path, entry);
  });

  function openOnDisk(path){
    var a = api();
    if (a) try { a.postMessage({ type: "enhImgOpen", path: path }); } catch (e) {}
  }

  function paint(tile, path, entry){
    if (!tile || !tile.isConnected) return;
    tile.textContent = "";
    tile.classList.remove("is-loading");

    if (entry.error) {
      tile.classList.add("is-error");
      var msg = document.createElement("span");
      msg.className = "enh-img-errtext";
      msg.textContent = entry.error === "too-large" ? T_TOOBIG : T_ERR;
      tile.appendChild(msg);
      tile.title = path + " (" + entry.error + ")";
      tile.onclick = function(){ openOnDisk(path); };
      return;
    }

    var img = document.createElement("img");
    img.className = "enh-img-thumb";
    img.src = entry.dataUri;
    img.alt = "";
    img.draggable = false;
    tile.appendChild(img);

    var open = document.createElement("button");
    open.type = "button";
    open.className = "enh-img-openbtn";
    open.title = T_OPEN;
    open.setAttribute("aria-label", T_OPEN);
    open.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
    open.addEventListener("click", function(e){
      e.preventDefault(); e.stopPropagation();
      openOnDisk(path);
    });
    tile.appendChild(open);

    tile.title = T_ZOOM;
    tile.onclick = function(e){
      if (e && (e.target === open || open.contains(e.target))) return;
      zoom(entry.dataUri, path);
    };
  }

  function zoom(dataUri, path){
    var prev = document.querySelector(".enh-img-overlay");
    if (prev) prev.remove();

    var ov = document.createElement("div");
    ov.className = "enh-img-overlay";
    var box = document.createElement("div");
    box.className = "enh-img-overlaybox";
    var big = document.createElement("img");
    big.className = "enh-img-full";
    big.src = dataUri;
    big.alt = "";

    var bar = document.createElement("div");
    bar.className = "enh-img-bar";

    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "enh-img-barbtn";
    openBtn.textContent = T_OPEN;
    openBtn.addEventListener("click", function(e){ e.stopPropagation(); openOnDisk(path); });

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "enh-img-barbtn enh-img-close";
    closeBtn.title = T_CLOSE;
    closeBtn.setAttribute("aria-label", T_CLOSE);
    closeBtn.textContent = "\\u2715";
    closeBtn.addEventListener("click", function(e){ e.stopPropagation(); close(); });

    bar.appendChild(openBtn);
    bar.appendChild(closeBtn);
    box.appendChild(bar);
    box.appendChild(big);
    ov.appendChild(box);

    function close(){
      ov.remove();
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e){
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }
    ov.addEventListener("click", function(e){ if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(ov);
    requestAnimationFrame(function(){ ov.classList.add("is-open"); });
  }

  function hydrate(strip){
    if (!strip) return;
    var list = strip.getAttribute("data-enh-imgs");
    if (!list) return;
    var scope = strip.getAttribute("data-enh-key") || "";
    var raw = list + "#" + scope;
    if (strip.dataset.enhImgRaw === raw && strip.childElementCount > 0) return;
    var paths;
    try { paths = JSON.parse(list); } catch (e) { return; }
    if (!Array.isArray(paths) || !paths.length) return;
    strip.dataset.enhImgRaw = raw;
    strip.textContent = "";
    paths.forEach(function(p){
      var tile = document.createElement("div");
      tile.className = "enh-img-tile is-loading";
      strip.appendChild(tile);
      requestImage(p, tile, scope);
    });
  }

  function scan(root){
    if (!root || root.nodeType !== 1) return;
    if (root.classList && root.classList.contains("enh-img-strip")) hydrate(root);
    if (root.querySelectorAll) {
      var list = root.querySelectorAll(".enh-img-strip");
      for (var i = 0; i < list.length; i++) hydrate(list[i]);
    }
  }

  function start(){
    // New strips, and strips React kept but gave new paths or a result.
    new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].type === "attributes") { hydrate(muts[i].target); continue; }
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) scan(added[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-enh-imgs", "data-enh-key"] });
    scan(document.body);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
  } catch (_) {}
})();`
}

export const IMAGE_HOST = `;(function(){
  if (globalThis.__enhancerImageHostInstalled) return;
  globalThis.__enhancerImageHostInstalled = true;

  var fs = require("fs"), os = require("os"), path = require("path");
  var vscode = null;
  try { vscode = require("vscode"); } catch (e) {}

  var MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
    ".avif": "image/avif", ".ico": "image/x-icon", ".svg": "image/svg+xml"
  };
  var MAX_BYTES = 16 * 1024 * 1024;

  function resolvePath(p) {
    if (typeof p !== "string" || !p.trim()) return null;
    p = p.trim();
    if (p.charAt(0) === "~") p = path.join(os.homedir(), p.slice(1));
    if (path.isAbsolute(p)) return p;
    var roots = (vscode && vscode.workspace && vscode.workspace.workspaceFolders) || [];
    for (var i = 0; i < roots.length; i++) {
      var cand = path.join(roots[i].uri.fsPath, p);
      if (fs.existsSync(cand)) return cand;
    }
    return null;
  }

  // The file's first bytes must be an image of its kind: a renamed text file is refused.
  function looksLikeImage(buf, ext) {
    var b = buf, ascii = function(from, to){ return b.toString("latin1", from, to); };
    if (ext === ".png") return b.length > 8 && b[0] === 0x89 && ascii(1, 4) === "PNG";
    if (ext === ".jpg" || ext === ".jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (ext === ".gif") return ascii(0, 4) === "GIF8";
    if (ext === ".webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    if (ext === ".bmp") return ascii(0, 2) === "BM";
    if (ext === ".avif") return ascii(4, 8) === "ftyp";
    if (ext === ".ico") return b.length > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;
    // A template literal: "\\s" here is "\s" in the written code (review rv-72c52030 R11).
    if (ext === ".svg") return /<svg[\\s>]/i.test(b.toString("utf8", 0, Math.min(b.length, 65536)));
    return false;
  }

  /** The real file behind p (links followed), when it is an image by name; else null. */
  function realImage(p, done) {
    fs.realpath(p, function(err, real) {
      if (err || !real) return done(null);
      var ext = path.extname(real).toLowerCase();
      done(MIME[ext] && MIME[path.extname(p).toLowerCase()] ? { path: real, ext: ext } : null);
    });
  }

  function reply(webview, payload) {
    try { webview.postMessage(payload); } catch (e) {}
  }

  globalThis.__enhancerImageHandle = function(webview, msg) {
    if (!webview || !msg) return;
    var p = resolvePath(msg.path);
    var id = msg.id;
    var fail = function(error){ reply(webview, { type: "enhImgData", id: id, ok: false, error: error }); };

    if (msg.type === "enhImgOpen") {
      if (!p || !vscode) return;
      realImage(p, function(img) {
        if (!img) return;
        try { vscode.commands.executeCommand("vscode.open", vscode.Uri.file(img.path)); } catch (e) {}
      });
      return;
    }

    if (!p) return fail("not-found");
    if (!MIME[path.extname(p).toLowerCase()]) return fail("unsupported");

    realImage(p, function(img) {
      if (!img) return fs.access(p, function(gone) { fail(gone ? "not-found" : "unsupported"); });
      fs.stat(img.path, function(err, st) {
        if (err || !st || !st.isFile()) return fail("not-found");
        if (st.size > MAX_BYTES) return fail("too-large");
        fs.readFile(img.path, function(rerr, buf) {
          if (rerr || !buf) return fail("read-failed");
          if (!looksLikeImage(buf, img.ext)) return fail("unsupported");
          reply(webview, { type: "enhImgData", id: id, ok: true, dataUri: "data:" + MIME[img.ext] + ";base64," + buf.toString("base64") });
        });
      });
    });
  };
})();`

/** The jsx / jsxs helper names the bundle uses for the tool row (they rotate per build). */
export function findJsxAliases (js: string) {
  const found = [...new Set([...js.matchAll(JSX_ALIASES)].map(m => `${m[1]}|${m[3]}`))]
  if (found.length !== 1) throw new AnchorError(`tool-row renderer: ${found.length} matches, expected 1`)
  const [jsxs, jsx] = found[0].split('|')
  return { jsx, jsxs }
}

function wrapToolBody (js: string) {
  const { jsx, jsxs } = findJsxAliases(js)
  let count = 0
  const out = js.replace(TOOL_BODY, (_whole, fn, msg, tu, ctx, card, lookup, res, extra) => {
    count++
    const call = `${lookup}(${tu}.name,${ctx}).body(${ctx},${tu}.input,${res},${msg}.progress.value${extra})`
    const guard = `${IMAGE_GUARD_OPEN}if(window.__enhancerImageBody)return window.__enhancerImageBody(${tu},(${res}),${call},${jsx},${jsxs});${IMAGE_GUARD_CLOSE}`
    return `function ${fn}(${msg},${tu},${ctx}${card}){${guard}return ${call}}`
  })
  if (count !== 1) throw new AnchorError(`tool-body renderer: ${count} matches, expected 1`)
  return out
}

function routeHostMessages (ext: string) {
  let count = 0
  const out = ext.replace(HOST_IPC, (_whole, host, arg) => {
    count++
    return `${host}.webview.onDidReceiveMessage((${arg})=>{${IMAGE_IPC_OPEN}if(${arg}&&(${arg}.type==="enhImgRead"||${arg}.type==="enhImgOpen")){if(globalThis.__enhancerImageHandle)globalThis.__enhancerImageHandle(${host}.webview,${arg});return;}${IMAGE_IPC_CLOSE}`
  })
  if (count === 0) throw new AnchorError('webview message handler not found in extension.js')
  return out
}

// Optional: without it, clicking an image's file name keeps Claude Code's own behaviour.
function openImagesInViewer (ext: string) {
  // Groups: 1 the whole try/catch, 2 fs, 3 the path, 4 vscode, 5 the uri.
  return ext.replace(OPEN_FILE, (_match, whole, _fs, p, vs, uri) =>
    `${whole}${IMAGE_OPEN_OPEN}if(/\\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i.test(${p})){${vs}.commands.executeCommand("vscode.open",${uri});return}${IMAGE_OPEN_CLOSE}`)
}

/** `text` with the shim block in front, in the file's own line endings. */
function prependShim (text: string) {
  const eol = lineEndingOf(text)
  return `${IMAGE_SHIM_BEGIN}${IMAGE_SHIM}${IMAGE_SHIM_END}${eol}${text}`
}

/** The injected code between `begin` and `end` must parse on its own. */
function parses (text: string, begin: string, end: string, what: string) {
  const start = text.lastIndexOf(begin)
  const stop = text.lastIndexOf(end)
  if (start < 0 || stop < start) throw new Error(`the image preview ${what} is missing`)
  new vm.Script(text.slice(start + begin.length, stop).replace(/;$/, ''))
}

export const imagePreviewRecipe: Recipe = {
  id: 'imagePreview',
  // Verified on the pristine copies of 2.1.296, 2.1.300, 2.1.301 and 2.1.302 (anchors and the round trip).
  apply (texts: FileTexts, options: RecipeOptions = DEFAULT_RECIPE_OPTIONS): FileTexts {
    const css = texts['webview/index.css']
    const js = texts['webview/index.js']
    const ext = texts['extension.js']
    if (css === undefined) throw new AnchorError('webview/index.css is missing')
    if (js === undefined) throw new AnchorError('webview/index.js is missing')
    if (ext === undefined) throw new AnchorError('extension.js is missing')
    const webview = prependShim(wrapToolBody(js))
    const host = openImagesInViewer(routeHostMessages(ext))
    return {
      'webview/index.css': appendBlock(css, IMAGE_CSS_BEGIN, IMAGE_CSS, IMAGE_CSS_END),
      // The leading ";" ends whatever statement the bundle's last line left open.
      'webview/index.js': appendBlock(webview, `;${IMAGE_JS_BEGIN}`, imageScript(options.text), `;${IMAGE_JS_END}`),
      'extension.js': appendBlock(host, `;${IMAGE_HOST_BEGIN}`, IMAGE_HOST, `;${IMAGE_HOST_END}`),
    }
  },
  validate (_before, after) {
    const js = after['webview/index.js'] ?? ''
    const ext = after['extension.js'] ?? ''
    const css = after['webview/index.css'] ?? ''
    parses(js, IMAGE_JS_BEGIN, IMAGE_JS_END, 'script block')
    parses(js, IMAGE_SHIM_BEGIN, IMAGE_SHIM_END, 'shim')
    parses(ext, IMAGE_HOST_BEGIN, IMAGE_HOST_END, 'host block')
    if (js.split(IMAGE_GUARD_OPEN).length !== 2) throw new Error('the tool-body guard is missing or doubled')
    if (!ext.includes(IMAGE_IPC_OPEN)) throw new Error('the message routing is missing')
    if (!css.includes(IMAGE_CSS_BEGIN) || !css.includes(IMAGE_CSS_END)) throw new Error('the image preview style block is missing')
  },
}
