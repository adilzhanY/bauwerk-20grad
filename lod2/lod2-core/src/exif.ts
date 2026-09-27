/**
 * Minimal Exif reader.
 *
 * Only the compass direction feeds any logic: the GPS coordinates in a street-level phone
 * photo are metres off, but the bearing holds up well enough to say which wall is in frame.
 * `readExifSummary` reads a few more fields purely so the editor can show them to the user.
 */

export interface CompassDirection {
  /** Degrees clockwise from north, 0 to 360. */
  degrees: number
  /** 'T' for true north, 'M' for magnetic north. */
  ref: 'T' | 'M' | null
}

const MARKER = 0xff
const APP1 = 0xe1
const START_OF_SCAN = 0xda
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
const TAG_GPS_IFD = 0x8825
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IMG_DIRECTION_REF = 0x0010
const TAG_GPS_IMG_DIRECTION = 0x0011
const TYPE_BYTE = 1
const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5

/** Tags in the main image directory (IFD0). */
const TAG_MAKE = 0x010f
const TAG_MODEL = 0x0110
const TAG_ORIENTATION = 0x0112
const TAG_SOFTWARE = 0x0131
/** Tags in the Exif directory. */
const TAG_EXPOSURE_TIME = 0x829a
const TAG_F_NUMBER = 0x829d
const TAG_ISO = 0x8827
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_FOCAL_LENGTH = 0x920a
const TAG_PIXEL_X = 0xa002
const TAG_PIXEL_Y = 0xa003
const TAG_FOCAL_LENGTH_35MM = 0xa405
const TAG_LENS_MODEL = 0xa434
/** Tags in the GPS directory. */
const TAG_GPS_LATITUDE_REF = 0x0001
const TAG_GPS_LATITUDE = 0x0002
const TAG_GPS_LONGITUDE_REF = 0x0003
const TAG_GPS_LONGITUDE = 0x0004
const TAG_GPS_ALTITUDE_REF = 0x0005
const TAG_GPS_ALTITUDE = 0x0006
const TAG_GPS_POSITION_ERROR = 0x001f

/** What the editor shows about a photo. Every field is null when the file does not say. */
export interface ExifSummary {
  make: string | null
  model: string | null
  lensModel: string | null
  software: string | null
  /** Local time the photo was taken, "2026-08-20 15:19:11". */
  dateTaken: string | null
  focalLengthMm: number | null
  focalLength35mm: number | null
  fNumber: number | null
  exposureSeconds: number | null
  iso: number | null
  pixelWidth: number | null
  pixelHeight: number | null
  /** Exif orientation code, 1 means the pixels are stored upright. */
  orientation: number | null
  /** Decimal degrees, south and west negative. */
  latitude: number | null
  longitude: number | null
  /** Metres, below sea level negative. */
  altitudeM: number | null
  /** The phone's own estimate of its horizontal position error, metres. */
  positionErrorM: number | null
  direction: CompassDirection | null
}

/** Compass direction from a JPEG's bytes, or null when the file carries none. */
export function readCompassDirection(bytes: Uint8Array): CompassDirection | null {
  const tiff = findExifBlock(bytes)
  if (!tiff) return null
  return readDirectionFromTiff(tiff)
}

/** The camera, exposure and location fields of a JPEG, or null when it has no Exif block. */
export function readExifSummary(bytes: Uint8Array): ExifSummary | null {
  const tiff = findExifBlock(bytes)
  if (!tiff) return null
  const r = tiffReader(tiff)
  if (!r) return null
  const ifd0Offset = r.u32(4)
  if (ifd0Offset === null) return null

  const ifd0 = tagMap(readIfd(r, ifd0Offset))
  const exif = subDirectory(r, ifd0, TAG_EXIF_IFD)
  const gps = subDirectory(r, ifd0, TAG_GPS_IFD)

  return {
    make: readAscii(r, ifd0.get(TAG_MAKE)),
    model: readAscii(r, ifd0.get(TAG_MODEL)),
    lensModel: readAscii(r, exif.get(TAG_LENS_MODEL)),
    software: readAscii(r, ifd0.get(TAG_SOFTWARE)),
    dateTaken: exifDate(readAscii(r, exif.get(TAG_DATE_TIME_ORIGINAL))),
    focalLengthMm: readRationalEntry(r, exif.get(TAG_FOCAL_LENGTH)),
    focalLength35mm: readUnsigned(r, exif.get(TAG_FOCAL_LENGTH_35MM)),
    fNumber: readRationalEntry(r, exif.get(TAG_F_NUMBER)),
    exposureSeconds: readRationalEntry(r, exif.get(TAG_EXPOSURE_TIME)),
    iso: readUnsigned(r, exif.get(TAG_ISO)),
    pixelWidth: readUnsigned(r, exif.get(TAG_PIXEL_X)),
    pixelHeight: readUnsigned(r, exif.get(TAG_PIXEL_Y)),
    orientation: readUnsigned(r, ifd0.get(TAG_ORIENTATION)),
    latitude: readCoordinate(r, gps.get(TAG_GPS_LATITUDE), gps.get(TAG_GPS_LATITUDE_REF), 'S'),
    longitude: readCoordinate(r, gps.get(TAG_GPS_LONGITUDE), gps.get(TAG_GPS_LONGITUDE_REF), 'W'),
    altitudeM: readAltitude(r, gps.get(TAG_GPS_ALTITUDE), gps.get(TAG_GPS_ALTITUDE_REF)),
    positionErrorM: readRationalEntry(r, gps.get(TAG_GPS_POSITION_ERROR)),
    direction: readDirectionFromTiff(tiff),
  }
}

/**
 * True when two pixel sizes are the same, either as given or with width and height swapped.
 * A phone often stores a portrait photo's Exif size the landscape way round, which is the same
 * size rotated and not a real disagreement.
 */
export function sizesMatchIgnoringRotation(
  widthA: number,
  heightA: number,
  widthB: number,
  heightB: number,
): boolean {
  const sameWay = widthA === widthB && heightA === heightB
  const rotated = widthA === heightB && heightA === widthB
  return sameWay || rotated
}

/** The wall the camera was looking at faces back towards the camera. */
export function expectedWallFacing(cameraDirection: number): number {
  return (((cameraDirection + 180) % 360) + 360) % 360
}

/** Smallest angle between two bearings, 0 to 180, so 355 and 5 are 10 apart. */
export function angleDifference(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360
  return d > 180 ? 360 - d : d
}

/** Walk the JPEG segments and return the TIFF block inside the Exif APP1 segment. */
function findExifBlock(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== MARKER || bytes[1] !== 0xd8) return null
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== MARKER) return null
    const type = bytes[pos + 1]!
    if (type === START_OF_SCAN) return null
    const length = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    if (length < 2) return null
    const segmentStart = pos + 4
    const segmentEnd = pos + 2 + length
    if (segmentEnd > bytes.length) return null
    if (type === APP1 && hasExifHeader(bytes, segmentStart)) {
      return bytes.subarray(segmentStart + EXIF_HEADER.length, segmentEnd)
    }
    pos = segmentEnd
  }
  return null
}

function hasExifHeader(bytes: Uint8Array, at: number): boolean {
  for (let i = 0; i < EXIF_HEADER.length; i++) {
    if (bytes[at + i] !== EXIF_HEADER[i]) return false
  }
  return true
}

/** Little helpers for reading numbers in the TIFF block's own byte order. */
interface TiffReader {
  u16(offset: number): number | null
  u32(offset: number): number | null
  byte(offset: number): number | null
}

function tiffReader(tiff: Uint8Array): TiffReader | null {
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49 // "II"
  const bigEndian = tiff[0] === 0x4d && tiff[1] === 0x4d // "MM"
  if (!littleEndian && !bigEndian) return null
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const inRange = (offset: number, size: number) => offset >= 0 && offset + size <= tiff.length
  return {
    u16: (o) => (inRange(o, 2) ? view.getUint16(o, littleEndian) : null),
    u32: (o) => (inRange(o, 4) ? view.getUint32(o, littleEndian) : null),
    byte: (o) => (inRange(o, 1) ? tiff[o]! : null),
  }
}

interface IfdEntry {
  tag: number
  type: number
  count: number
  /** Offset of the four-byte value-or-pointer field. */
  valueAt: number
}

function readIfd(r: TiffReader, offset: number): IfdEntry[] {
  const count = r.u16(offset)
  if (count === null) return []
  const entries: IfdEntry[] = []
  for (let k = 0; k < count; k++) {
    const at = offset + 2 + k * 12
    const tag = r.u16(at)
    const type = r.u16(at + 2)
    const n = r.u32(at + 4)
    if (tag === null || type === null || n === null) return entries
    entries.push({ tag, type, count: n, valueAt: at + 8 })
  }
  return entries
}

function readDirectionFromTiff(tiff: Uint8Array): CompassDirection | null {
  const r = tiffReader(tiff)
  if (!r) return null
  const ifd0 = r.u32(4)
  if (ifd0 === null) return null

  const gpsPointer = readIfd(r, ifd0).find((e) => e.tag === TAG_GPS_IFD)
  if (!gpsPointer) return null
  const gpsIfd = r.u32(gpsPointer.valueAt)
  if (gpsIfd === null) return null

  let degrees: number | null = null
  let ref: CompassDirection['ref'] = null
  for (const entry of readIfd(r, gpsIfd)) {
    if (entry.tag === TAG_GPS_IMG_DIRECTION && entry.type === TYPE_RATIONAL) {
      degrees = readRational(r, entry)
    } else if (entry.tag === TAG_GPS_IMG_DIRECTION_REF && entry.type === TYPE_ASCII) {
      ref = readRefLetter(r, entry)
    }
  }
  if (degrees === null || !Number.isFinite(degrees)) return null
  return { degrees: ((degrees % 360) + 360) % 360, ref }
}

/** A RATIONAL is two u32 (numerator, denominator) stored where the entry points. */
function readRational(r: TiffReader, entry: IfdEntry): number | null {
  const at = r.u32(entry.valueAt)
  if (at === null) return null
  const numerator = r.u32(at)
  const denominator = r.u32(at + 4)
  if (numerator === null || denominator === null || denominator === 0) return null
  return numerator / denominator
}

/** A short ASCII value (up to 4 bytes) lives inside the entry itself. */
function readRefLetter(r: TiffReader, entry: IfdEntry): CompassDirection['ref'] {
  const letter = r.byte(entry.valueAt)
  if (letter === 0x54) return 'T'
  if (letter === 0x4d) return 'M'
  return null
}

/** Directory entries keyed by tag, for looking fields up by name. */
function tagMap(entries: IfdEntry[]): Map<number, IfdEntry> {
  const map = new Map<number, IfdEntry>()
  for (const entry of entries) map.set(entry.tag, entry)
  return map
}

/** The entries of a directory that `parent` points to with `pointerTag`, or an empty map. */
function subDirectory(r: TiffReader, parent: Map<number, IfdEntry>, pointerTag: number): Map<number, IfdEntry> {
  const pointer = parent.get(pointerTag)
  if (!pointer) return new Map()
  const offset = r.u32(pointer.valueAt)
  if (offset === null) return new Map()
  return tagMap(readIfd(r, offset))
}

/** Bytes one value of a TIFF type takes, or null for types this reader does not handle. */
function typeSize(type: number): number | null {
  if (type === TYPE_BYTE || type === TYPE_ASCII) return 1
  if (type === TYPE_SHORT) return 2
  if (type === TYPE_LONG) return 4
  if (type === TYPE_RATIONAL) return 8
  return null
}

/** Where an entry's data starts: inside the entry when it fits in four bytes, else at its pointer. */
function dataOffset(r: TiffReader, entry: IfdEntry): number | null {
  const size = typeSize(entry.type)
  if (size === null) return null
  if (size * entry.count <= 4) return entry.valueAt
  return r.u32(entry.valueAt)
}

/** An ASCII string with its trailing NUL and spaces removed. Null when empty or absent. */
function readAscii(r: TiffReader, entry: IfdEntry | undefined): string | null {
  if (!entry || entry.type !== TYPE_ASCII) return null
  const start = dataOffset(r, entry)
  if (start === null) return null
  let text = ''
  for (let i = 0; i < entry.count; i++) {
    const code = r.byte(start + i)
    if (code === null || code === 0) break
    text += String.fromCharCode(code)
  }
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** The first value of a BYTE, SHORT or LONG entry. */
function readUnsigned(r: TiffReader, entry: IfdEntry | undefined): number | null {
  if (!entry) return null
  const start = dataOffset(r, entry)
  if (start === null) return null
  if (entry.type === TYPE_BYTE) return r.byte(start)
  if (entry.type === TYPE_SHORT) return r.u16(start)
  if (entry.type === TYPE_LONG) return r.u32(start)
  return null
}

/** The `index`th RATIONAL of an entry. */
function readRationalAt(r: TiffReader, entry: IfdEntry, index: number): number | null {
  if (entry.type !== TYPE_RATIONAL || index >= entry.count) return null
  const start = dataOffset(r, entry)
  if (start === null) return null
  const numerator = r.u32(start + index * 8)
  const denominator = r.u32(start + index * 8 + 4)
  if (numerator === null || denominator === null || denominator === 0) return null
  return numerator / denominator
}

function readRationalEntry(r: TiffReader, entry: IfdEntry | undefined): number | null {
  if (!entry) return null
  return readRationalAt(r, entry, 0)
}

/** Degrees, minutes and seconds to decimal degrees, negative on the `negativeRef` side. */
function readCoordinate(
  r: TiffReader,
  entry: IfdEntry | undefined,
  refEntry: IfdEntry | undefined,
  negativeRef: 'S' | 'W',
): number | null {
  if (!entry) return null
  const degrees = readRationalAt(r, entry, 0)
  const minutes = readRationalAt(r, entry, 1)
  const seconds = readRationalAt(r, entry, 2)
  if (degrees === null || minutes === null || seconds === null) return null
  const value = degrees + minutes / 60 + seconds / 3600
  return readAscii(r, refEntry) === negativeRef ? -value : value
}

/** Altitude in metres; reference byte 1 means below sea level. */
function readAltitude(r: TiffReader, entry: IfdEntry | undefined, refEntry: IfdEntry | undefined): number | null {
  const altitude = readRationalEntry(r, entry)
  if (altitude === null) return null
  return readUnsigned(r, refEntry) === 1 ? -altitude : altitude
}

/** "2026:08:20 15:19:11" to "2026-08-20 15:19:11". Left unchanged when it is not that shape. */
function exifDate(value: string | null): string | null {
  if (!value) return null
  const match = /^(\d{4}):(\d{2}):(\d{2}) (.*)$/.exec(value)
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}` : value
}
