import * as assert from 'assert/strict'
import { describe, test } from 'node:test'

import type { Status } from '../engine/engine.ts'
import type { NewsItem } from '../panel/news.ts'
import { panelState, resultForFolder } from '../panel/state.ts'
import type { PanelInput } from '../panel/state.ts'

const enhanced: Status = { version: '2.1.301', baseline: 'ok', files: 'enhanced', appliedFeatures: ['rtl', 'broom', 'quoteReply', 'quoteTools', 'imagePreview'] }
const news: NewsItem = { id: 'launch', title: { en: 'New', ar: 'جديد' }, text: { en: 'Text', ar: 'نص' }, url: 'https://ornus.ai/x' }

const input = (over: Partial<PanelInput> = {}): PanelInput => ({
  turnedOn: true,
  featureSetting: () => undefined,
  reapplyAfterUpdate: true,
  checkForUpdates: true,
  ornusNews: true,
  feedbackButton: true, feedbackDetails: { extension: '0.1.0', claudeCode: '2.1.301', editor: 'Visual Studio Code 1.105.0', os: 'darwin arm64' },
  feedbackAnswers: [],
  claudeCode: { status: enhanced },
  lastResult: { outcome: 'applied', changed: false, features: [
    { id: 'rtl', outcome: 'applied' }, { id: 'broom', outcome: 'applied' }, { id: 'quoteReply', outcome: 'applied' }, { id: 'quoteTools', outcome: 'applied' }, { id: 'imagePreview', outcome: 'applied' },
  ] },
  syncing: false,
  reloadPending: false,
  updateAvailable: undefined,
  news,
  justVerified: false,
  language: { setting: 'auto', everywhere: true },
  ...over,
})

describe('control panel state', () => {
  test('before the user turns Enhancer on, the panel welcomes them', () => {
    const s = panelState(input({ turnedOn: false, lastResult: undefined }))
    assert.equal(s.view, 'welcome')
    assert.equal(s.mascot, 'welcome')
    assert.equal(s.canTurnOn, true)
    assert.equal(s.notice, undefined)
  })

  test('the welcome has no Turn on when Claude Code is missing, and no mascot', () => {
    const s = panelState(input({ turnedOn: false, claudeCode: undefined, lastResult: undefined }))
    assert.equal(s.view, 'welcome')
    assert.equal(s.mascot, null)
    assert.equal(s.canTurnOn, false)
    assert.deepEqual(s.notice, { kind: 'no-claude-code' })
  })

  test('all applied: active on the Claude Code version, calm mascot, news shown', () => {
    const s = panelState(input())
    assert.equal(s.view, 'main')
    assert.deepEqual(s.status, { kind: 'active', version: '2.1.301' })
    assert.equal(s.mascot, 'still')
    assert.equal(s.news?.id, 'launch')
    assert.deepEqual(s.features.map(f => [f.id, f.on, f.active, f.problem]), [
      ['rtl', true, true, undefined], ['broom', true, true, undefined], ['quoteReply', true, true, undefined], ['quoteTools', true, true, undefined], ['imagePreview', true, true, undefined]])
  })

  test('the Interface broom choices: off by default and icon shown; the saved choices; unavailable while the broom is off', () => {
    assert.deepEqual(panelState(input()).broomOptions, { startsOn: false, button: true, available: true })
    const chosen = { broomStartsOn: true, broomButton: false } as Record<string, boolean>
    assert.deepEqual(panelState(input({ featureSetting: name => chosen[name] })).broomOptions, { startsOn: true, button: false, available: true })
    assert.deepEqual(panelState(input({ featureSetting: name => name === 'broom' ? false : undefined })).broomOptions, { startsOn: false, button: true, available: false })
  })

  test('a finished apply is acknowledged once by the mascot', () => {
    assert.equal(panelState(input({ justVerified: true })).mascot, 'verified')
  })

  test('while writing: applying status, working mascot, switches greyed, no reload banner yet', () => {
    const s = panelState(input({ syncing: true, reloadPending: true }))
    assert.deepEqual(s.status, { kind: 'applying' })
    assert.equal(s.mascot, 'applying')
    assert.equal(s.busy, true)
    assert.equal(s.reloadPending, false)
    assert.equal(s.news, undefined)
  })

  test('another editor window writing shows as applying', () => {
    assert.deepEqual(panelState(input({ claudeCode: { status: 'busy' } })).status, { kind: 'applying' })
  })

  test('after a change the reload banner shows', () => {
    assert.equal(panelState(input({ reloadPending: true })).reloadPending, true)
  })

  test('a new Claude Code version where no feature fit: 0 of 5, every row waits, not the re-apply notice', () => {
    const s = panelState(input({
      claudeCode: { status: { ...enhanced, version: '2.1.310', files: 'pristine', appliedFeatures: [] } },
      lastResult: { outcome: 'applied', changed: false, features: [
        { id: 'rtl', outcome: 'failed', reason: 'a' }, { id: 'broom', outcome: 'failed', reason: 'b' },
        { id: 'quoteReply', outcome: 'failed', reason: 'c' }, { id: 'quoteTools', outcome: 'failed', reason: 'd' }, { id: 'imagePreview', outcome: 'failed', reason: 'e' },
      ] },
    }))
    assert.deepEqual(s.status, { kind: 'partial', active: 0, total: 5 })
    assert.equal(s.notice, undefined)
    assert.deepEqual(s.features.map(f => f.problem), ['failed', 'failed', 'failed', 'failed', 'failed'])
    assert.equal(s.features.some(f => f.active), false)
    assert.equal(s.news, undefined)
  })

  test('one feature failed: 4 of 5, its row marked, no mascot and no news', () => {
    const s = panelState(input({ lastResult: { outcome: 'applied', changed: true, features: [
      { id: 'rtl', outcome: 'applied' }, { id: 'broom', outcome: 'failed', reason: 'anchor missing' },
      { id: 'quoteReply', outcome: 'applied' }, { id: 'quoteTools', outcome: 'applied' }, { id: 'imagePreview', outcome: 'applied' },
    ] } }))
    assert.deepEqual(s.status, { kind: 'partial', active: 4, total: 5 })
    assert.equal(s.mascot, null)
    assert.equal(s.news, undefined)
    assert.deepEqual(s.features[1], { id: 'broom', setting: 'broom', on: true, problem: 'failed', reason: 'anchor missing' })
    assert.deepEqual(s.features.filter(f => f.active).map(f => f.id), ['rtl', 'quoteReply', 'quoteTools', 'imagePreview'])
  })

  test('a feature switched off is neither active nor waiting', () => {
    const s = panelState(input({ featureSetting: name => name === 'quoteTools' ? false : undefined }))
    assert.deepEqual(s.features[3], { id: 'quoteTools', setting: 'quoteTools', on: false })
  })

  test('a failure of a feature the user turned off is not shown', () => {
    const s = panelState(input({
      featureSetting: name => name === 'broom' ? false : undefined,
      lastResult: { outcome: 'applied', changed: false, features: [{ id: 'broom', outcome: 'failed', reason: 'x' }] },
    }))
    assert.equal(s.features[1].problem, undefined)
    assert.deepEqual(s.status, { kind: 'active', version: '2.1.301' })
  })

  test('every feature off: off status', () => {
    const s = panelState(input({ featureSetting: () => false, claudeCode: { status: { ...enhanced, files: 'pristine', appliedFeatures: [] } }, lastResult: { outcome: 'restored', changed: true } }))
    assert.deepEqual(s.status, { kind: 'off' })
    assert.equal(s.notice, undefined)
  })

  test('another tool changed Claude Code: attention, notice, no mascot', () => {
    const s = panelState(input({ claudeCode: { status: { ...enhanced, files: 'modified-elsewhere' } }, lastResult: { outcome: 'modified-elsewhere', reason: 'x' } }))
    assert.deepEqual(s.notice, { kind: 'modified-elsewhere' })
    assert.equal(s.mascot, null)
  })

  test('a locked file asks for a reload', () => {
    assert.deepEqual(panelState(input({ lastResult: { outcome: 'locked', file: 'webview/index.js' } })).notice, { kind: 'locked' })
  })

  test('Claude Code removed after turning on: the missing notice', () => {
    assert.deepEqual(panelState(input({ claudeCode: undefined })).notice, { kind: 'no-claude-code' })
  })

  test('a new Claude Code left original because re-apply is off: notice with the version', () => {
    const s = panelState(input({ reapplyAfterUpdate: false, lastResult: undefined, claudeCode: { status: { ...enhanced, version: '2.1.302', files: 'pristine', appliedFeatures: [] } } }))
    assert.deepEqual(s.notice, { kind: 'not-applied', version: '2.1.302' })
  })

  test('the news switch off hides the news; the update switch off hides the update', () => {
    const s = panelState(input({ ornusNews: false, checkForUpdates: false, updateAvailable: '0.2.0' }))
    assert.equal(s.news, undefined)
    assert.equal(s.updateAvailable, undefined)
    assert.equal(panelState(input({ updateAvailable: '0.2.0' })).updateAvailable, '0.2.0')
  })

  test('turning everything off while a file is locked does not claim Claude Code is original', () => {
    const s = panelState(input({ featureSetting: () => false, lastResult: { outcome: 'locked', file: 'webview/index.js' } }))
    assert.deepEqual(s.notice, { kind: 'locked' })
    assert.deepEqual(s.status, { kind: 'attention' })
    assert.equal(s.news, undefined)
  })

  test('everything off but the files still enhanced: not restored, with no news', () => {
    const s = panelState(input({ featureSetting: () => false, lastResult: undefined }))
    assert.deepEqual(s.notice, { kind: 'not-restored' })
    assert.deepEqual(s.status, { kind: 'attention' })
    assert.equal(s.mascot, null)
    assert.equal(s.news, undefined)
  })

  test('after a restart with no last result, a feature missing from the files shows as not applied', () => {
    const s = panelState(input({ lastResult: undefined, claudeCode: { status: { ...enhanced, appliedFeatures: ['rtl', 'quoteReply', 'quoteTools', 'imagePreview'] } } }))
    assert.deepEqual(s.status, { kind: 'partial', active: 4, total: 5 })
    assert.equal(s.features[1].problem, 'failed')
    assert.equal(s.mascot, null)
  })

  test('a result counts only for the Claude Code folder it ran on', () => {
    const last = { dir: '/ext/anthropic.claude-code-2.1.301', result: 'old' }
    assert.equal(resultForFolder(last, '/ext/anthropic.claude-code-2.1.301'), 'old')
    assert.equal(resultForFolder(last, '/ext/anthropic.claude-code-2.1.302'), undefined)
    assert.equal(resultForFolder(last, undefined), undefined)
    assert.equal(resultForFolder(undefined, '/ext/x'), undefined)
  })
})
