#!/usr/bin/env node
// Recovery tool on the same engine: restores Claude Code even when the editor will not
// open. Usage:
//   enhancer-recover status  <claude-code-folder> [--storage <folder>]
//   enhancer-recover restore <claude-code-folder> [--storage <folder>]
// Without --storage it looks for the Enhancer's saved copy in each known editor's
// storage folder (VS Code, Cursor, Devin, Ornus, VS Code Insiders, VSCodium) on this system.
import * as fs from 'fs'
import * as path from 'path'

import { Engine } from './engine/engine.ts'
import { DEFAULT_RECIPE_OPTIONS } from './engine/recipe.ts'
import { allRecipeOptions } from './features.ts'
import { RECIPES } from './recipes/index.ts'
import { engineStorageDirs } from './storage.ts'

/** The storage folders holding a saved copy for this Claude Code folder. */
function candidateStorages (claudeDir: string) {
  return engineStorageDirs()
    .filter(storage => fs.existsSync(path.join(storage, 'baselines', path.basename(claudeDir), 'manifest.json')))
}

async function main (argv: string[]) {
  const [command, claudeDir, ...rest] = argv
  const storageFlag = rest.indexOf('--storage')
  if (!command || !claudeDir || !['status', 'restore'].includes(command)) {
    console.error('usage: enhancer-recover status|restore <claude-code-folder> [--storage <folder>]')
    return 2
  }
  const storages = storageFlag >= 0 ? [rest[storageFlag + 1]] : candidateStorages(claudeDir)
  if (storages.length === 0) {
    console.error('No saved original copy of this Claude Code folder was found. Reinstalling Claude Code also restores it.')
    return 1
  }
  for (const storage of storages) {
    const engine = new Engine(storage, RECIPES, () => DEFAULT_RECIPE_OPTIONS, allRecipeOptions)
    const result = command === 'status' ? await engine.status(claudeDir) : await engine.restore(claudeDir)
    console.log(JSON.stringify({ storage, ...result }))
  }
  return 0
}

main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
  console.error(error)
  process.exitCode = 1
})
