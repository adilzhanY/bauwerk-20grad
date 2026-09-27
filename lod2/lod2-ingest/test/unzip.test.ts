import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { readArchiveMember } from '../src/unzip.ts'

/**
 * Build a ZIP by hand rather than committing a binary fixture.
 *
 * The point of the reader is that it understands the container, so the test should be able
 * to say what is in the container — including the awkward parts: a member before the one we
 * want, a stored (uncompressed) entry, and a local header whose extra field is a different
 * length from the central directory's, which is where a naive reader lands on the wrong byte.
 */
function buildZip(members: Array<{ name: string; body: string; store?: boolean; localExtra?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const m of members) {
    const name = Buffer.from(m.name, 'utf8')
    const raw = Buffer.from(m.body, 'utf8')
    const data = m.store ? raw : deflateRawSync(raw)
    const extra = Buffer.alloc(m.localExtra ?? 0)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(m.store ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(extra.length, 28)
    locals.push(local, name, extra, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(m.store ? 0 : 8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + extra.length + data.length
  }

  const localBytes = Buffer.concat(locals)
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(members.length, 8)
  eocd.writeUInt16LE(members.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(localBytes.length, 16)
  return Buffer.concat([localBytes, centralBytes, eocd])
}

const GML = '<?xml version="1.0"?><CityModel><bldg:Building gml:id="x"/></CityModel>'

test('the wanted member is read past the ones before it', () => {
  // A tile archive can hold the CityGML beside other members, and the order is not
  // guaranteed — so the reader must select by `archiveMember`, not take the first entry.
  const zip = buildZip([
    { name: 'LoD2_389_5819_meta.html', body: '<html>metadata</html>' },
    { name: 'LoD2_389_5819_BE.xml', body: GML },
  ])
  const member = readArchiveMember(zip, /_BE\.xml$/i)
  assert.equal(member.name, 'LoD2_389_5819_BE.xml')
  assert.equal(member.data.toString('utf8'), GML)
})

test('a local header with its own extra field is still located correctly', () => {
  // The local header's name and extra lengths are authoritative for where the data starts,
  // and they routinely differ from the central directory's. Reading the central directory's
  // lengths instead puts the inflate a few bytes off, which fails as "invalid distance".
  const zip = buildZip([{ name: 'a_geb.gml', body: GML, localExtra: 17 }])
  assert.equal(readArchiveMember(zip, /\.gml$/).data.toString('utf8'), GML)
})

test('a stored member is returned uncompressed', () => {
  const zip = buildZip([{ name: 'plain_geb.gml', body: GML, store: true }])
  assert.equal(readArchiveMember(zip, /\.gml$/).data.toString('utf8'), GML)
})

test('a missing member names what the archive does hold', () => {
  // The error a mistyped pattern deserves: an adapter's archiveMember is easy to get wrong
  // and impossible to debug from "not found".
  const zip = buildZip([{ name: 'readme.txt', body: 'nothing here' }])
  assert.throws(() => readArchiveMember(zip, /\.gml$/), /archive holds: readme\.txt/)
})

test('something that is not a ZIP says so', () => {
  // The realistic case is a portal serving an HTML error page with 200 OK, which would
  // otherwise reach the XML parser and fail as a confusing syntax error.
  const html = Buffer.from('<!DOCTYPE html><html><body>Wartungsarbeiten</body></html>')
  assert.throws(() => readArchiveMember(html, /\.gml$/), /not a ZIP archive/)
})
