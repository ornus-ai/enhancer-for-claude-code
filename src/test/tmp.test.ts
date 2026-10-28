import * as assert from 'assert/strict'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { describe, test } from 'node:test'

// Runs a separate Node process that makes a folder with makeTempDir and then ends the
// way `ending` says; answers the folder it made.
function folderLeftBy (ending: string): string {
  const helper = path.join(__dirname, 'tmp.js')
  const script = `const dir = require(${JSON.stringify(helper)}).makeTempDir('enhancer-tmp-check-');
require('fs').writeFileSync(require('path').join(dir, 'file.txt'), 'x');
process.stdout.write(dir);
${ending}`
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  assert.ok(run.stdout, `the helper process printed no folder: ${run.stderr}`)
  return run.stdout
}

describe('test temp folders', () => {
  test('a test file that passes leaves no temp folder behind', () => {
    assert.equal(fs.existsSync(folderLeftBy('')), false)
  })

  test('a test file that throws leaves no temp folder behind', () => {
    assert.equal(fs.existsSync(folderLeftBy("throw new Error('test failed')")), false)
  })

  test('a test file that exits with a failure code leaves no temp folder behind', () => {
    assert.equal(fs.existsSync(folderLeftBy('process.exit(1)')), false)
  })
})
