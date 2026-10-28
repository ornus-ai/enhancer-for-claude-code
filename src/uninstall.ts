// Run by the editor (package.json "vscode:uninstall") after Enhancer is uninstalled:
// puts every Claude Code folder Enhancer changed back to its saved original, so removing
// Enhancer never leaves Claude Code modified.
import * as fs from 'fs'

import { Engine } from './engine/engine.ts'
import { DEFAULT_RECIPE_OPTIONS } from './engine/recipe.ts'
import { allRecipeOptions } from './features.ts'
import { RECIPES } from './recipes/index.ts'
import { engineStorageDirs } from './storage.ts'

async function main () {
  for (const storage of engineStorageDirs().filter(dir => fs.existsSync(dir))) {
    const results = await new Engine(storage, RECIPES, () => DEFAULT_RECIPE_OPTIONS, allRecipeOptions).restoreAll()
    for (const { extensionDir, result } of results) console.log(`${extensionDir}: ${JSON.stringify(result)}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
