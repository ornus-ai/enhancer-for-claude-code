// The editor side: finds Claude Code through the editor's own extension API, keeps its
// files matching the user's settings once the user turned Enhancer on, follows Claude
// Code updates, hosts the control panel, and never reloads the window by itself (a
// reload could cut a running Claude task).
import * as path from 'path'
import * as vscode from 'vscode'

import { Engine } from './engine/engine.ts'
import type { ApplyResult, RestoreResult, Status } from './engine/engine.ts'
import type { FeatureId } from './engine/recipe.ts'
import { RECIPES } from './recipes/index.ts'
import { FEATURE_SETTINGS, INTERFACE_SETTINGS, allRecipeOptions, enabledFeaturesFrom, outsideLanguage, recipeOptionsFrom, turnedOnFrom } from './features.ts'
import { fill, isLanguageSetting, resolveLanguage, textFor } from './i18n/index.ts'
import { feedbackRequest, isSendable, postFeedback } from './panel/feedback.ts'
import type { FeedbackResult } from './panel/feedback.ts'
import type { PanelMessage } from './panel/messages.ts'
import { ORNUS_DOWNLOAD_URL, NEWS_URL, campaignLink, isApprovedLink, newsItemsFrom, newsToShow } from './panel/news.ts'
import type { NewsItem } from './panel/news.ts'
import { isPanelVisible, refreshPanel, showPanel } from './panel/panel.ts'
import type { PanelHost } from './panel/panel.ts'
import { panelMeta, panelState, resultForFolder } from './panel/state.ts'
import { STORE_PAGE, checkFrom, fetchJson, isNewer, latestVersionIn, storeFor } from './panel/updates.ts'
import type { UpdateCheck } from './panel/updates.ts'
import { HOME_VIEW, OPEN_PANEL_COMMAND, homeViewVisibilityHandler, statusBarEntry } from './statusBar.ts'

const CLAUDE_CODE_ID = 'anthropic.claude-code'
const ENHANCER_ID = 'enhancer.enhancer-for-claude-code'
// How often the update check and the news file are fetched again (at most).
const FETCH_EVERY_MS = 12 * 60 * 60_000

// globalState keys
const TURNED_ON = 'turnedOn'
const WELCOME_SHOWN = 'welcomeShown'
const UPDATE_CHECK = 'updateCheck'
const NEWS_CACHE = 'newsCache'
const NEWS_DISMISSED = 'newsDismissed'

let context: vscode.ExtensionContext
let engine: Engine
let output: vscode.OutputChannel
// One sync at a time: an update event and a settings change can arrive together.
let queue: Promise<void> = Promise.resolve()
// What the panel shows besides the files themselves.
// The last apply or restore, tied to the Claude Code folder it ran on: an update installs a
// new folder, and the old folder's result must not speak for it.
let lastResult: { dir: string; result: ApplyResult | RestoreResult } | undefined
const lastResultFor = (dir: string | undefined) => resultForFolder(lastResult, dir)
let syncing = false
let reloadPending = false
let justVerified = false
// The answers to the last feedback sends from the panel, by the id the page gave each; they
// travel in the panel state, so a tab hidden while sending still learns its own answer when
// shown again, whatever order two sends finished in.
let feedbackAnswers: { id: string; result: FeedbackResult }[] = []

const log = (line: string) => output.appendLine(`${new Date().toISOString()} ${line}`)
const config = () => vscode.workspace.getConfiguration('enhancer')
const ownVersion = () => String(context.extension.packageJSON.version ?? '0.0.0')

// ---------- Language ----------
const languageSetting = () => {
  const value = config().get<string>('language')
  return isLanguageSetting(value) ? value : 'auto'
}
/** The control panel's language. */
const panelLanguage = () => resolveLanguage(languageSetting(), vscode.env.language)
/** The language of the chat's labels, the status bar and notifications. */
const outsideLang = () => outsideLanguage(panelLanguage(), config().get<boolean>('languageEverywhere'))
/** A notification text in the outside language, `{0}`… filled. */
const say = (key: keyof ReturnType<typeof textFor>, ...args: (string | number)[]) => fill(textFor(outsideLang())[key], ...args)

function claudeCodeDir () {
  return vscode.extensions.getExtension(CLAUDE_CODE_ID)?.extensionPath
}

function enabledFeatures (): FeatureId[] {
  const settings = config()
  return enabledFeaturesFrom(name => settings.get<boolean>(name))
}

const isTurnedOn = () => context.globalState.get<boolean>(TURNED_ON) === true

/** The panel state as it stands, without using up the mascot's one-time acknowledgement. */
async function currentPanelState () {
  const dir = claudeCodeDir()
  let status: Status | 'busy' | 'locked' = 'busy'
  // While this window writes, the engine lock is held: reading the status would wait for
  // the write to finish, and the panel would never show "Applying".
  if (dir && !syncing) {
    const read = await engine.status(dir).catch(() => ({ outcome: 'busy' as const }))
    status = 'files' in read ? read : read.outcome
  }
  const settings = config()
  const state = panelState({
    turnedOn: isTurnedOn(),
    featureSetting: name => settings.get<boolean>(name),
    reapplyAfterUpdate: settings.get<boolean>('reapplyAfterUpdate') ?? true,
    checkForUpdates: settings.get<boolean>('checkForUpdates') ?? true,
    ornusNews: settings.get<boolean>('ornusNews') ?? true,
    feedbackButton: settings.get<boolean>('feedbackButton') ?? true,
    feedbackAnswers,
    feedbackDetails: {
      extension: ownVersion(),
      claudeCode: typeof status === 'object' ? status.version ?? '?' : dir ? '?' : 'not installed',
      editor: `${vscode.env.appName} ${vscode.version}`,
      os: `${process.platform} ${process.arch}`,
    },
    claudeCode: dir ? { status } : undefined,
    lastResult: lastResultFor(dir),
    syncing,
    reloadPending,
    updateAvailable: updateAvailable(),
    news: currentNews(),
    justVerified,
    language: { setting: languageSetting(), everywhere: settings.get<boolean>('languageEverywhere') ?? true },
  })
  return state
}

const panelHost: PanelHost = {
  meta: () => panelMeta(ownVersion(), panelLanguage()),
  state: async () => {
    const state = await currentPanelState()
    justVerified = false
    return state
  },
  onMessage: message => onPanelMessage(message),
}
const refresh = () => refreshPanel(panelHost).catch(error => log(`panel: ${(error as Error).stack ?? error}`))

async function offerReload (message: string) {
  // The open panel carries its own Reload banner; a second prompt would only add noise.
  if (isPanelVisible()) return
  const reload = say('m_reloadWindow')
  const choice = await vscode.window.showInformationMessage(message, reload, say('later'))
  if (choice === reload) await vscode.commands.executeCommand('workbench.action.reloadWindow')
}

async function report (result: ApplyResult, quietWhenUnchanged: boolean) {
  log(`apply: ${JSON.stringify(result)}`)
  const quiet = isPanelVisible()
  switch (result.outcome) {
    case 'applied': {
      const failed = result.features.filter(f => f.outcome !== 'applied')
      if (result.changed) {
        reloadPending = true
        justVerified = failed.length === 0
      }
      if (failed.length > 0 && !quiet) {
        const names = failed.map(f => say(`f_${f.id}` as 'f_rtl'))
        void vscode.window.showWarningMessage(say('m_notApplied', names.join(', ')))
      }
      // Not awaited: an unanswered notification must not hold the sync queue.
      if (result.changed) void offerReload(say('m_ready'))
      else if (!quietWhenUnchanged && failed.length === 0 && !quiet) void vscode.window.showInformationMessage(say('m_already'))
      return
    }
    case 'modified-elsewhere':
      if (!quiet) {
        void vscode.window.showWarningMessage(say('m_modified', result.reason))
      }
      return
    case 'locked':
      if (!quiet) void vscode.window.showWarningMessage(say('m_locked'))
      return
    case 'busy':
      // Another editor window is applying the same change right now.
      return
    case 'no-claude-code':
      log(result.reason)
  }
}

/**
 * Brings the Claude Code files in line with the settings. Does nothing before the user
 * turned Enhancer on. `automatic` syncs (start-up, a Claude Code update) skip writing
 * when the user turned "re-apply after updates" off.
 */
function sync (options: { quietWhenUnchanged: boolean; automatic: boolean }) {
  queue = queue.then(async () => {
    const dir = claudeCodeDir()
    if (!dir) {
      log('Claude Code is not installed')
      return
    }
    if (!isTurnedOn()) return
    if (options.automatic && config().get<boolean>('reapplyAfterUpdate') === false) {
      log('re-apply after updates is off: left Claude Code as it is')
      // Still finish a write a crash or a closed editor interrupted.
      await engine.recover().catch(error => log(`recover: ${(error as Error).message}`))
      return
    }
    syncing = true
    void refresh()
    try {
      const features = enabledFeatures()
      if (features.length === 0) {
        const restored = await engine.restore(dir)
        log(`restore: ${JSON.stringify(restored)}`)
        lastResult = { dir, result: restored }
        if (restored.outcome === 'restored' && restored.changed) {
          reloadPending = true
          void offerReload(say('m_restored'))
        }
        return
      }
      const result = await engine.apply(dir, features)
      lastResult = { dir, result }
      await report(result, options.quietWhenUnchanged)
    } finally {
      syncing = false
    }
  }).catch(error => {
    log(`error: ${(error as Error).stack ?? error}`)
    void vscode.window.showErrorMessage(say('m_error'))
  }).then(refresh)
  return queue
}

const syncNow = () => sync({ quietWhenUnchanged: false, automatic: false })

async function turnOn () {
  await context.globalState.update(TURNED_ON, true)
  // Turned on with every feature switched off would change nothing: switch them all on.
  if (enabledFeatures().length === 0) {
    for (const { setting } of FEATURE_SETTINGS) await config().update(setting, true, vscode.ConfigurationTarget.Global)
  }
  await syncNow()
}

async function restoreOriginal () {
  // Turning every feature off makes the sync restore, and keeps it restored after updates.
  for (const { setting } of FEATURE_SETTINGS) await config().update(setting, false, vscode.ConfigurationTarget.Global)
  await syncNow()
}

// ---------- Update check and Ornus news (each behind its own switch) ----------

type NewsCache = { at: number; items: NewsItem[] }

const ownStore = () => storeFor(vscode.env.uriScheme)

/** The update check of this editor's own store, when there is one. */
function ownStoreCheck () {
  return checkFrom(ownStore(), context.globalState.get<UpdateCheck>(UPDATE_CHECK))
}

function updateAvailable () {
  const latest = ownStoreCheck()?.latest
  return latest && isNewer(latest, ownVersion()) ? latest : undefined
}

function currentNews () {
  const items = context.globalState.get<NewsCache>(NEWS_CACHE)?.items ?? []
  // Checked again on every read: a cached item past its date or edited by hand never shows.
  const valid = newsItemsFrom({ items }, new Date())
  return newsToShow(valid, context.globalState.get<string[]>(NEWS_DISMISSED) ?? [])
}

async function fetchRemote (options: { force: boolean }) {
  const now = Date.now()
  const stale = (at: number | undefined) => options.force || at === undefined || now - at > FETCH_EVERY_MS
  const jobs: Promise<void>[] = []
  if (config().get<boolean>('checkForUpdates') !== false && stale(ownStoreCheck()?.at)) {
    const store = ownStore()
    jobs.push(latestVersionIn(store).then(latest =>
      context.globalState.update(UPDATE_CHECK, { at: now, latest, store } satisfies UpdateCheck)))
  }
  if (config().get<boolean>('ornusNews') !== false && stale(context.globalState.get<NewsCache>(NEWS_CACHE)?.at)) {
    jobs.push(fetchJson(NEWS_URL).then(file => {
      // An unreachable file keeps the last good items.
      if (file === undefined) return
      return context.globalState.update(NEWS_CACHE, { at: now, items: newsItemsFrom(file, new Date()) } satisfies NewsCache)
    }))
  }
  if (jobs.length === 0) return
  await Promise.all(jobs).catch(error => log(`fetch: ${(error as Error).message}`))
  void refresh()
}

// ---------- Panel actions ----------

async function onPanelMessage (message: PanelMessage) {
  switch (message.type) {
    case 'turnOn': return turnOn()
    case 'applyNow': return syncNow()
    case 'setFeature':
    case 'setInterface':
      // The settings change runs the sync.
      return void await config().update(message.setting, message.on, vscode.ConfigurationTarget.Global)
    case 'setLanguage':
      return void await config().update('language', message.language, vscode.ConfigurationTarget.Global)
    case 'setOption':
      await config().update(message.setting, message.on, vscode.ConfigurationTarget.Global)
      if (message.on && (message.setting === 'checkForUpdates' || message.setting === 'ornusNews')) void fetchRemote({ force: true })
      return refresh()
    case 'reload': return void await vscode.commands.executeCommand('workbench.action.reloadWindow')
    case 'later':
      reloadPending = false
      return refresh()
    case 'restore': {
      const restore = say('m_restoreButton')
      const choice = await vscode.window.showWarningMessage(say('m_restoreAsk'), { modal: true, detail: say('m_restoreDetail') }, restore)
      if (choice === restore) await restoreOriginal()
      return
    }
    case 'openLog': return output.show(true)
    case 'downloadOrnus': return void await vscode.env.openExternal(vscode.Uri.parse(ORNUS_DOWNLOAD_URL))
    case 'openNews': {
      const news = currentNews()
      if (news && isApprovedLink(news.url)) await vscode.env.openExternal(vscode.Uri.parse(campaignLink(news.url)))
      return
    }
    case 'dismissNews': {
      const dismissed = context.globalState.get<string[]>(NEWS_DISMISSED) ?? []
      if (!dismissed.includes(message.id)) await context.globalState.update(NEWS_DISMISSED, [...dismissed, message.id].slice(-100))
      return refresh()
    }
    case 'featureProblem': {
      const entry = FEATURE_SETTINGS.find(f => f.id === message.id)
      if (!entry) return
      const last = lastResultFor(claudeCodeDir())
      const failure = last?.outcome === 'applied' ? last.features.find(f => f.id === entry.id) : undefined
      const showLog = say('m_showLog')
      const turnOff = say('m_turnOff')
      const choice = await vscode.window.showWarningMessage(`${say('m_featureProblem')}${failure?.reason ? ` (${failure.reason})` : ''}`, showLog, turnOff)
      if (choice === showLog) output.show(true)
      if (choice === turnOff) await config().update(entry.setting, false, vscode.ConfigurationTarget.Global)
      return
    }
    // The editor's own Extensions view shows the page of the store it installs from, with its
    // Update button; an editor without that command gets the store's website instead.
    case 'update': return void await vscode.commands.executeCommand('extension.open', ENHANCER_ID)
      .then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(STORE_PAGE[ownStore()])))
    case 'sendFeedback': {
      const { type: _, id, ...draft } = message
      let result: FeedbackResult = 'invalid'
      if (isSendable(draft)) {
        // The details are built here again from the extension's own facts, never taken from the page.
        const { feedback } = await currentPanelState()
        result = await postFeedback(feedbackRequest(draft, feedback.details, panelLanguage()))
      }
      log(`feedback: ${draft.kind} ${result}`)
      feedbackAnswers = [...feedbackAnswers.filter(a => a.id !== id), { id, result }].slice(-10)
      return refresh()
    }
  }
}

export async function activate (extensionContext: vscode.ExtensionContext) {
  context = extensionContext
  output = vscode.window.createOutputChannel('Enhancer')
  engine = new Engine(path.join(context.globalStorageUri.fsPath, 'state'), RECIPES, () => {
    const settings = config()
    return recipeOptionsFrom(name => settings.get<boolean>(name), textFor(outsideLang()))
  }, allRecipeOptions)
  const openPanel = () => {
    showPanel(context, panelHost)
    void fetchRemote({ force: false })
  }
  const statusBar = vscode.window.createStatusBarItem('enhancer.status', vscode.StatusBarAlignment.Right, 100)
  statusBar.name = 'Enhancer for Claude Code'
  Object.assign(statusBar, statusBarEntry(outsideLang()))
  statusBar.show()
  // The activity bar icon: clicking it shows this (empty) view, which opens the panel;
  // its welcome button opens it again while the view stays shown.
  const home = vscode.window.createTreeView(HOME_VIEW, { treeDataProvider: { getChildren: () => [], getTreeItem: (item: vscode.TreeItem) => item } })
  const onHomeVisibility = homeViewVisibilityHandler(home.visible, openPanel)
  context.subscriptions.push(
    output,
    statusBar,
    home,
    home.onDidChangeVisibility(event => onHomeVisibility(event.visible)),
    vscode.commands.registerCommand(OPEN_PANEL_COMMAND, openPanel),
    vscode.commands.registerCommand('enhancer.enable', async () => {
      await config().update('arabic', true, vscode.ConfigurationTarget.Global)
      await turnOn()
    }),
    vscode.commands.registerCommand('enhancer.enableBroom', async () => {
      await config().update('broom', true, vscode.ConfigurationTarget.Global)
      await turnOn()
    }),
    vscode.commands.registerCommand('enhancer.restore', restoreOriginal),
    vscode.commands.registerCommand('enhancer.status', async () => {
      const dir = claudeCodeDir()
      if (!dir) return void vscode.window.showInformationMessage(say('m_noClaude'))
      const status = await engine.status(dir)
      log(`status: ${JSON.stringify(status)}`)
      if (!('files' in status)) return void vscode.window.showInformationMessage(say('m_busy'))
      const features = status.appliedFeatures.map(id => say(`f_${id}` as 'f_rtl')).join(', ')
      const state = { pristine: say('m_original'), enhanced: say('m_enhanced', features), 'modified-elsewhere': say('m_changedElsewhere') }[status.files]
      void vscode.window.showInformationMessage(say('m_status', status.version ?? '?', state, status.baseline === 'ok' ? say('m_yes') : say('m_no')))
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('enhancer.language') || event.affectsConfiguration('enhancer.languageEverywhere')) {
        Object.assign(statusBar, statusBarEntry(outsideLang()))
      }
      // The language reaches the chat's labels, so it rewrites the files like the switches.
      const writesFiles = [...FEATURE_SETTINGS.map(f => f.setting), ...INTERFACE_SETTINGS, 'language']
      if (writesFiles.some(setting => event.affectsConfiguration(`enhancer.${setting}`))) void syncNow()
      else if (event.affectsConfiguration('enhancer')) void refresh()
    }),
    // Update detection: a Claude Code update installs a new folder; follow it.
    vscode.extensions.onDidChange(() => void sync({ quietWhenUnchanged: true, automatic: true })),
  )

  // Users of an earlier version, whose Claude Code Enhancer already changed, stay turned on.
  const dir = claudeCodeDir()
  if (dir && context.globalState.get<boolean>(TURNED_ON) === undefined) {
    const status = await engine.status(dir).catch(() => undefined)
    if (turnedOnFrom(undefined, status && 'files' in status ? status.files : undefined)) await context.globalState.update(TURNED_ON, true)
  }

  // First run: the panel opens once to welcome the user; nothing is changed before "Turn on".
  if (dir && !isTurnedOn() && !context.globalState.get<boolean>(WELCOME_SHOWN)) {
    await context.globalState.update(WELCOME_SHOWN, true)
    openPanel()
  }
  void fetchRemote({ force: false })
  await sync({ quietWhenUnchanged: true, automatic: true })
}

export function deactivate () {}
