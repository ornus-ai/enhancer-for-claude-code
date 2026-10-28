// The control panel as an editor tab: one at a time, a strict content policy (only this
// extension's own media and one script with a nonce), and every message checked.
import * as crypto from 'crypto'
import * as vscode from 'vscode'

import { parsePanelMessage } from './messages.ts'
import type { PanelMessage } from './messages.ts'
import type { PanelMeta, PanelState } from './state.ts'

export type PanelHost = {
  state: () => Promise<PanelState>
  /** The panel's language, its texts and the extension's version. */
  meta: () => PanelMeta
  onMessage: (message: PanelMessage) => void | Promise<void>
}

let current: vscode.WebviewPanel | undefined

export function panelHtml (options: { cspSource: string; cssUri: string; scriptUri: string; lang: string; dir: 'ltr' | 'rtl'; nonce: string }) {
  const { cspSource, cssUri, scriptUri, lang, dir, nonce } = options
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; img-src ${cspSource} data:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${cssUri}">
<title>Enhancer</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

export const isPanelVisible = () => current?.visible ?? false

let refreshes = 0
/** Sends the current state to the panel, if it is open. */
export async function refreshPanel (host: PanelHost) {
  if (!current) return
  const panel = current
  const call = ++refreshes
  const state = await host.state()
  // A slower, older refresh must not overwrite a newer state.
  if (current === panel && call === refreshes) void panel.webview.postMessage({ type: 'state', state, meta: host.meta() })
}

export function showPanel (context: vscode.ExtensionContext, host: PanelHost) {
  if (current) {
    current.reveal()
    return
  }
  const media = vscode.Uri.joinPath(context.extensionUri, 'media')
  const panel = vscode.window.createWebviewPanel('enhancer.panel', 'Enhancer', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [media],
  })
  current = panel
  panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg')
  panel.webview.html = panelHtml({
    cspSource: panel.webview.cspSource,
    cssUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css')).toString(),
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js')).toString(),
    lang: host.meta().lang,
    dir: host.meta().dir,
    nonce: crypto.randomBytes(16).toString('base64'),
  })
  panel.onDidDispose(() => { if (current === panel) current = undefined }, null, context.subscriptions)
  // A hidden tab drops its page; it asks again with "ready" when shown.
  panel.webview.onDidReceiveMessage(raw => {
    const message = parsePanelMessage(raw)
    if (!message) return
    if (message.type === 'ready') return void refreshPanel(host)
    return host.onMessage(message)
  }, null, context.subscriptions)
}
