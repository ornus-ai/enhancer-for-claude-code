// Helpers every recipe uses: finding Claude Code's hashed CSS classes and appending a
// marked block to a file in that file's own line endings.
import { lineEndingOf } from '../engine/files.ts'

/** Every distinct `<name>_<6-char hash>` class in `text`, matched as a whole class name. */
export function classesNamed (text: string, name: string) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_-])${name}_[A-Za-z0-9]{6}(?![A-Za-z0-9])`, 'g')
  return [...new Set(text.match(pattern) ?? [])]
}

/** `text` with `begin`, `body` and `end` appended on their own lines, in the file's line endings. */
export const appendBlock = (text: string, begin: string, body: string, end: string, lead = '') => {
  const eol = lineEndingOf(text)
  const block = [begin, body, end].join('\n').replace(/\n/g, eol)
  return `${text}${eol}${lead}${block}${eol}`
}
