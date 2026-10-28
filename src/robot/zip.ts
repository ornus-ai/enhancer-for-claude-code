// A minimal zip reader for the robot: a VSIX is a zip, and the robot needs four files
// out of it on Windows and macOS alike, without a dependency or a platform `unzip`/`tar`
// (Git's GNU tar on Windows runners cannot read zips).
import * as zlib from 'zlib'

const END_OF_CENTRAL_DIR = 0x06054b50
const CENTRAL_ENTRY = 0x02014b50
const LOCAL_ENTRY = 0x04034b50
const ZIP64_MARK = 0xffffffff

function endOfCentralDirectory (zip: Buffer) {
  // The record is 22 bytes plus a comment of at most 65535 bytes, at the very end.
  const lowest = Math.max(0, zip.length - 22 - 0xffff)
  for (let at = zip.length - 22; at >= lowest; at--) {
    if (zip.readUInt32LE(at) === END_OF_CENTRAL_DIR) return at
  }
  throw new Error('not a zip file: no end of central directory')
}

/** The bytes of each wanted entry found in `zip` (names as stored, forward slashes). */
export function readZipEntries (zip: Buffer, wanted: readonly string[]): Map<string, Buffer> {
  const end = endOfCentralDirectory(zip)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  if (at === ZIP64_MARK) throw new Error('zip64 archives are not supported')
  const found = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL_ENTRY) throw new Error('damaged zip: bad central directory entry')
    const method = zip.readUInt16LE(at + 10)
    const compressedSize = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const localOffset = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extraLength + commentLength
    if (!wanted.includes(name)) continue
    if (compressedSize === ZIP64_MARK || localOffset === ZIP64_MARK) throw new Error(`zip64 entry not supported: ${name}`)
    if (zip.readUInt32LE(localOffset) !== LOCAL_ENTRY) throw new Error(`damaged zip: bad local header for ${name}`)
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const raw = zip.subarray(dataStart, dataStart + compressedSize)
    let bytes: Buffer
    if (method === 0) bytes = Buffer.from(raw)
    else if (method === 8) bytes = zlib.inflateRawSync(raw)
    else throw new Error(`unsupported zip compression ${method} for ${name}`)
    if (bytes.length !== size) throw new Error(`damaged zip: ${name} has ${bytes.length} bytes, expected ${size}`)
    found.set(name, bytes)
  }
  return found
}
