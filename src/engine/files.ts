// File primitives shared by the engine: hashing, atomic replace with retries for
// files a running editor holds open (Windows), and reading a file as text only when
// that text round-trips to the exact same bytes.
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex')

const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])
const RETRY_DELAYS_MS = [50, 100, 200, 400, 800]

export class FileLockedError extends Error {
  readonly file: string

  constructor (file: string, cause: unknown) {
    super(`${file} is locked by another program`)
    this.file = file
    this.cause = cause
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Test seam: replaced in tests to simulate a locked file or a crash mid-commit. */
export const io = {
  rename: (from: string, to: string) => fs.promises.rename(from, to),
}

/** Renames with retries while the target is locked; throws FileLockedError if it stays locked. */
export async function renameWithRetry (from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await io.rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!LOCK_CODES.has(code)) throw error
      if (attempt >= RETRY_DELAYS_MS.length) throw new FileLockedError(to, error)
      await sleep(RETRY_DELAYS_MS[attempt])
    }
  }
}

/** The temp file a staged write goes to: same folder as the target, so the rename is atomic. */
export const stagedPathOf = (target: string) => `${target}.enhancer-staged`

/** Writes bytes to a staged file beside the target (not yet visible to anyone). */
export async function stage (target: string, bytes: Buffer) {
  const staged = stagedPathOf(target)
  await fs.promises.writeFile(staged, bytes)
  return staged
}

/** Writes a small file atomically (staged then renamed), creating its folder. */
export async function writeAtomic (target: string, bytes: Buffer) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  const staged = await stage(target, bytes)
  try {
    await renameWithRetry(staged, target)
  } catch (error) {
    await removeIfExists(staged)
    throw error
  }
}

export async function readIfExists (file: string): Promise<Buffer | undefined> {
  try {
    return await fs.promises.readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Decodes UTF-8 only when re-encoding gives back the same bytes; undefined otherwise. */
export function exactText (bytes: Buffer): string | undefined {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : undefined
}

/** The line ending a text already uses, so injected blocks match it. */
export const lineEndingOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n')

export async function removeIfExists (file: string) {
  await fs.promises.rm(file, { force: true })
}
