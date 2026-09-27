/**
 * Just enough ZIP to read one member.
 *
 * Berlin publishes each tile as a ZIP archive rather than as bare GML, so a state adapter
 * points at a member (`archiveMember`) and the rest of the pipeline never learns that an
 * archive was involved. Node ships the compression but no container reader, and a dependency
 * for ~70 lines of well-specified format would be the larger commitment.
 *
 * Reads the central directory rather than scanning local headers: a local header may declare
 * sizes of zero and defer them to a trailing data descriptor, which is precisely the case
 * that makes naive scanners read garbage.
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** Deflate and "stored"; nothing else has ever appeared in a German geodata archive. */
const DEFLATED = 8
const STORED = 0

export interface ArchiveMember {
  name: string
  data: Buffer
}

/** Find the end-of-central-directory record, which the format only allows at the end. */
function findEocd(buf: Buffer): number {
  // 22 bytes fixed, plus a comment of up to 64 KiB.
  const from = Math.max(0, buf.length - (22 + 0xffff))
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record')
}

/**
 * Read the first member whose name matches, or throw naming what the archive does hold —
 * the error a mistyped pattern deserves.
 */
export function readArchiveMember(buf: Buffer, match: RegExp): ArchiveMember {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  if (count === 0xffff) throw new Error('ZIP64 archives are not supported')
  let offset = buf.readUInt32LE(eocd + 16)

  const names: string[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP: central directory entry ${i} has no signature`)
    }
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLength = buf.readUInt16LE(offset + 28)
    const extraLength = buf.readUInt16LE(offset + 30)
    const commentLength = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength)
    names.push(name)

    if (match.test(name)) {
      if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
        throw new Error(`corrupt ZIP: ${name} has no local header`)
      }
      // The local header's own name and extra lengths are authoritative for where data
      // starts, and they routinely differ from the central directory's.
      const localNameLength = buf.readUInt16LE(localOffset + 26)
      const localExtraLength = buf.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const raw = buf.subarray(start, start + compressedSize)
      if (method === STORED) return { name, data: Buffer.from(raw) }
      if (method === DEFLATED) return { name, data: inflateRawSync(raw) }
      throw new Error(`ZIP member ${name} uses unsupported compression method ${method}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`no ZIP member matching ${match} — archive holds: ${names.join(', ')}`)
}
