import * as assert from 'assert/strict'
import * as os from 'os'
import * as path from 'path'
import { test } from 'node:test'

import { engineStorageDirs } from '../storage.ts'

const storageIn = (editor: string) =>
  path.join(os.homedir(), 'Library', 'Application Support', editor, 'User', 'globalStorage', 'enhancer.enhancer-for-claude-code', 'state')

test('the recovery tool and the uninstall restore look in VS Code, Cursor and Devin storage', { skip: process.platform !== 'darwin' && 'macOS paths' }, () => {
  const dirs = engineStorageDirs()
  for (const editor of ['Code', 'Cursor', 'Devin']) assert.ok(dirs.includes(storageIn(editor)), `${editor} missing`)
})
