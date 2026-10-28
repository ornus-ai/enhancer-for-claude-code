import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { test } from 'node:test'

import { HOME_VIEW, homeViewVisibilityHandler, statusBarEntry } from '../statusBar.ts'

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))

test('the status bar entry opens the control panel, a command the extension declares', () => {
  const entry = statusBarEntry('en')
  assert.equal(entry.command, 'enhancer.openPanel')
  assert.ok(pkg.contributes.commands.some((c: { command: string }) => c.command === entry.command))
  assert.equal(entry.text, '$(comment-discussion) Enhancer')
  assert.equal(entry.tooltip, 'Open the Enhancer control panel')
  assert.equal(statusBarEntry('ar').tooltip, 'افتح لوحة تحكم Enhancer')
})

test('an activity bar icon shows a view whose button opens the control panel', () => {
  const container = pkg.contributes.viewsContainers.activitybar.find((c: { id: string }) => c.id === 'enhancer')
  assert.equal(container.icon, 'media/icon.svg')
  assert.ok(fs.existsSync(path.join(process.cwd(), container.icon)))
  assert.deepEqual(pkg.contributes.views.enhancer.map((v: { id: string }) => v.id), [HOME_VIEW])
  assert.equal(HOME_VIEW, 'enhancer.home')
  const welcome = pkg.contributes.viewsWelcome.find((w: { view: string }) => w.view === 'enhancer.home')
  // The text comes from package.nls.json (the editor shows the translation for its own language).
  assert.equal(welcome.contents, '%view.welcome%')
  const nls = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.nls.json'), 'utf8'))
  assert.equal(nls['view.welcome'], '[Open control panel](command:enhancer.openPanel)')
})

test('the extension has its own icon: a 256×256 PNG inside the package', () => {
  assert.equal(pkg.icon, 'media/icon.png')
  const png = fs.readFileSync(path.join(process.cwd(), pkg.icon))
  assert.deepEqual([...png.subarray(1, 4)].map(b => String.fromCharCode(b)).join(''), 'PNG')
  assert.equal(png.readUInt32BE(16), 256)
  assert.equal(png.readUInt32BE(20), 256)
})

test('the activity bar view opens the panel when the user shows it, not when the editor restores it at start', () => {
  let opened = 0
  const restored = homeViewVisibilityHandler(true, () => { opened++ })
  restored(true)
  assert.equal(opened, 0, 'the view the editor restored at start opened the panel')
  restored(false)
  restored(true)
  assert.equal(opened, 1, 'showing the view after it was hidden did not open the panel')

  let openedFresh = 0
  const fresh = homeViewVisibilityHandler(false, () => { openedFresh++ })
  fresh(true)
  assert.equal(openedFresh, 1, 'clicking the icon did not open the panel')
  fresh(true)
  assert.equal(openedFresh, 2)
})
