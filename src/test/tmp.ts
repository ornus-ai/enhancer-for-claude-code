// Temporary folders for tests, removed when the test file's process ends: passed,
// failed or thrown. Each `node --test` file runs in its own process, so a file's
// folders are gone as soon as that file finishes.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const madeDirs: string[] = []

export function makeTempDir (prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  madeDirs.push(dir)
  return dir
}

process.on('exit', () => {
  for (const dir of madeDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})
