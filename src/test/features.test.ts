import * as assert from 'assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { test } from 'node:test'

import { enabledFeaturesFrom, recipeOptionsFrom } from '../features.ts'
import { en } from '../i18n/en.ts'

test('a user who never touched the settings gets every feature', () => {
  assert.deepEqual(enabledFeaturesFrom(() => undefined), ['rtl', 'broom', 'quoteReply', 'quoteTools', 'imagePreview'])
})

test('turning one feature off keeps the others', () => {
  assert.deepEqual(enabledFeaturesFrom(name => name === 'arabic' ? false : undefined), ['broom', 'quoteReply', 'quoteTools', 'imagePreview'])
  assert.deepEqual(enabledFeaturesFrom(name => name === 'broom' ? false : undefined), ['rtl', 'quoteReply', 'quoteTools', 'imagePreview'])
  assert.deepEqual(enabledFeaturesFrom(name => name === 'quoteReply' ? false : undefined), ['rtl', 'broom', 'quoteTools', 'imagePreview'])
  assert.deepEqual(enabledFeaturesFrom(name => name === 'quoteTools' ? false : undefined), ['rtl', 'broom', 'quoteReply', 'imagePreview'])
  assert.deepEqual(enabledFeaturesFrom(name => name === 'imagePreview' ? false : undefined), ['rtl', 'broom', 'quoteReply', 'quoteTools'])
})

test('every feature off means no feature (Claude Code is restored)', () => {
  assert.deepEqual(enabledFeaturesFrom(() => false), [])
})

test('the Interface broom choices default to off and icon shown, the same in the code and in the editor settings', () => {
  assert.deepEqual(recipeOptionsFrom(() => undefined, en), { broomStartsOn: false, broomButton: true, text: en })
  const settings = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).contributes.configuration.properties
  assert.equal(settings['enhancer.broomStartsOn'].default, false)
  assert.equal(settings['enhancer.broomButton'].default, true)
  assert.deepEqual(recipeOptionsFrom(name => ({ broomStartsOn: true, broomButton: false } as Record<string, boolean>)[name], en), { broomStartsOn: true, broomButton: false, text: en })
})
