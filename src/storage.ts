// Where each editor keeps this extension's global storage, for the tools that run
// outside the editor (recovery CLI, uninstall hook) and cannot ask the editor.
import * as os from 'os'
import * as path from 'path'

/** `<publisher>.<name>` from package.json, lowercased as the editor stores it. */
export const EXTENSION_STORAGE_ID = 'enhancer.enhancer-for-claude-code'
const EDITOR_FOLDERS = ['Code', 'Cursor', 'Devin', 'Ornus', 'Code - Insiders', 'VSCodium']

function userDataRoots () {
  const home = os.homedir()
  if (process.platform === 'darwin') return EDITOR_FOLDERS.map(e => path.join(home, 'Library', 'Application Support', e))
  if (process.platform === 'win32') return EDITOR_FOLDERS.map(e => path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), e))
  return EDITOR_FOLDERS.map(e => path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), e))
}

/** The engine storage folder of every known editor on this system (existing or not). */
export const engineStorageDirs = () =>
  userDataRoots().map(root => path.join(root, 'User', 'globalStorage', EXTENSION_STORAGE_ID, 'state'))
