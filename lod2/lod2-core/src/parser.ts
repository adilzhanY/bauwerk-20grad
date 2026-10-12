/**
 * Streaming CityGML reader for the AdV LoD2 profile.
 *
 * Deliberately not a general CityGML implementation. It targets the profile every German
 * state ships (CityGML 1.0/2.0/3.0, `buildingLoD2.xsd`) and is driven by namespace URI +
 * local name, so it survives the prefix and version differences between states.
 *
 * Streaming is not optional: one square-kilometre tile holds a few thousand buildings and
 * tens of megabytes of coordinates, and a whole state is orders of magnitude more, so nothing
 * is ever held beyond the building currently being read.
 */
import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from 'saxes'
import type { Polygon, RawAddress, RawBuilding, Surface, SurfaceKind } from './types.ts'

type Ns = 'bldg' | 'gen' | 'core' | 'gml' | 'xal' | 'other'

/** Classify by namespace URI rather than prefix, so CityGML 1.0/2.0/3.0 all resolve. */
function nsOf(uri: string | undefined): Ns {
  if (!uri) return 'other'
  if (uri.includes('/citygml/building')) return 'bldg'
  if (uri.includes('/citygml/generics')) return 'gen'
  if (uri.includes('/citygml/')) return 'core'
  if (uri.includes('opengis.net/gml')) return 'gml'
  if (uri.includes('xAL')) return 'xal'
  return 'other'
}

const SURFACE_KINDS: Record<string, SurfaceKind> = {
  WallSurface: 'wall',
  RoofSurface: 'roof',
  GroundSurface: 'ground',
  ClosureSurface: 'closure',
  OuterCeilingSurface: 'roof',
  OuterFloorSurface: 'ground',
}

/** `lod2MultiSurface`, `lod2Solid`, `lod2Geometry`, … → 2 */
function lodOf(local: string): number | null {
  const m = /^lod(\d)(MultiSurface|Solid|Geometry|MultiCurve|TerrainIntersection)$/.exec(local)
  return m ? Number(m[1]) : null
}

interface Ctx {
  gid: string
  parentGid: string | null
  isPart: boolean
  creationDate: string | null
  functionCode: string | null
  roofTypeCode: string | null
  measuredHeight: number | null
  storeysAboveGround: number | null
  storeysBelowGround: number | null
  attributes: Record<string, string>
  address: RawAddress | null
  surfaces: Surface[]
  terrainIntersection: number[][]
  /** Polygons found outside any semantic surface, classified later by their normal. */
  looseGeometry: Polygon[]
}

export interface ParseOptions {
  sourceTile?: string
  /** Which LoD to keep. Defaults to 2. */
  lod?: number
}

export interface ParseSummary {
  buildings: number
  parts: number
  srsName: string | null
}

function parseCoords(text: string, srsDimension: number): number[] {
  const out: number[] = []
  // Fast manual scan; split() on multi-MB posLists allocates far too much.
  let i = 0
  const n = text.length
  const nums: number[] = []
  while (i < n) {
    while (i < n && (text.charCodeAt(i) <= 32)) i++
    const start = i
    while (i < n && text.charCodeAt(i) > 32) i++
    if (i > start) nums.push(Number(text.slice(start, i)))
  }
  if (srsDimension === 3) return nums
  // Pad 2D input to xyz so downstream code has one shape to handle.
  for (let k = 0; k + 1 < nums.length; k += 2) out.push(nums[k]!, nums[k + 1]!, 0)
  return out
}

/**
 * Read buildings out of a CityGML byte/character stream.
 *
 * Buildings are yielded as they close, so memory stays flat regardless of tile size.
 * `bldg:BuildingPart` is emitted as its own record with `parentGid` set rather than being
 * merged here: parts carry their own attributes and callers need to see them.
 */
export async function* streamBuildings(
  input: AsyncIterable<string | Buffer>,
  opts: ParseOptions = {},
): AsyncGenerator<RawBuilding, ParseSummary> {
  const wantLod = opts.lod ?? 2
  const parser = new SaxesParser<{ xmlns: true; position: false }>({ xmlns: true, position: false })

  const pending: RawBuilding[] = []
  const stack: Ctx[] = []
  const summary: ParseSummary = { buildings: 0, parts: 0, srsName: null }

  // --- transient parse state -------------------------------------------------
  let text = ''
  let capture = false
  let genAttrName: string | null = null
  let inBoundedBy = false
  let inTerrain = false
  let inAddress = false
  let lodDepth = 0 // >0 while inside a geometry property of the wanted LoD
  let surface: Surface | null = null
  let polygon: Polygon | null = null
  let ringTarget: 'exterior' | 'interior' | null = null
  let ring: number[] | null = null
  let srsDimension = 3
  let elemDepth = 0
  /** Depth at which a non-wanted LoD property opened, so we can skip its whole subtree. */
  let skipUntilDepth = -1

  const startCapture = () => {
    text = ''
    capture = true
  }

  parser.on('opentag', (tag: SaxesTagNS) => {
    elemDepth++
    if (skipUntilDepth >= 0) return

    const ns = nsOf(tag.uri)
    const local = tag.local
    const attrs = tag.attributes as Record<string, SaxesAttributeNS>
    /** Look up an attribute by local name, ignoring whichever prefix the file used. */
    const attr = (local: string): string | undefined => {
      for (const a of Object.values(attrs)) if (a.local === local) return a.value
      return undefined
    }
    const gmlId = (): string | null => attr('id') ?? null

    if (ns === 'bldg') {
      if (local === 'Building' || local === 'BuildingPart') {
        const isPart = local === 'BuildingPart'
        stack.push({
          gid: gmlId() ?? '',
          parentGid: isPart ? (stack[stack.length - 1]?.gid ?? null) : null,
          isPart,
          creationDate: null,
          functionCode: null,
          roofTypeCode: null,
          measuredHeight: null,
          storeysAboveGround: null,
          storeysBelowGround: null,
          attributes: {},
          address: null,
          surfaces: [],
          terrainIntersection: [],
          looseGeometry: [],
        })
        return
      }
      if (local === 'boundedBy') {
        inBoundedBy = true
        return
      }
      if (inBoundedBy && SURFACE_KINDS[local]) {
        surface = { id: gmlId(), kind: SURFACE_KINDS[local]!, polygons: [] }
        return
      }
      if (local === 'address') {
        inAddress = true
        stack[stack.length - 1]!.address ??= {
          street: null, houseNumber: null, postcode: null, city: null, country: null,
        }
        return
      }
      if (
        local === 'function' || local === 'roofType' || local === 'measuredHeight' ||
        local === 'storeysAboveGround' || local === 'storeysBelowGround'
      ) {
        startCapture()
        return
      }
      const lod = lodOf(local)
      if (lod !== null) {
        if (local.startsWith(`lod${wantLod}`)) {
          lodDepth++
          if (local === `lod${wantLod}TerrainIntersection`) inTerrain = true
        } else {
          skipUntilDepth = elemDepth // ignore geometry at other LoDs entirely
        }
        return
      }
    }

    if (ns === 'gen') {
      if (local.endsWith('Attribute')) {
        genAttrName = attr('name') ?? null
        return
      }
      if (local === 'value') {
        startCapture()
        return
      }
    }

    if (ns === 'core') {
      if (local === 'creationDate') startCapture()
      return
    }

    if (ns === 'xal' && inAddress) {
      if (
        local === 'ThoroughfareName' || local === 'BuildingNumber' ||
        local === 'PostalCodeNumber' || local === 'LocalityName' || local === 'CountryName'
      ) {
        startCapture()
        genAttrName = local
      }
      return
    }

    if (ns === 'gml') {
      if (local === 'Envelope') {
        summary.srsName ??= attr('srsName') ?? null
        return
      }
      if (local === 'Polygon' && lodDepth > 0) {
        polygon = { exterior: [], interiors: [] }
        return
      }
      if (local === 'exterior' && polygon) {
        ringTarget = 'exterior'
        return
      }
      if (local === 'interior' && polygon) {
        ringTarget = 'interior'
        return
      }
      if (local === 'LinearRing' && polygon && ringTarget) {
        ring = []
        return
      }
      if (local === 'LineString' && inTerrain) {
        ring = []
        ringTarget = 'exterior'
        return
      }
      if (local === 'posList' || local === 'pos') {
        srsDimension = Number(attr('srsDimension') ?? 3) || 3
        startCapture()
        return
      }
    }
  })

  parser.on('text', (t: string) => {
    if (capture) text += t
  })

  parser.on('closetag', (tag: SaxesTagNS) => {
    const closingDepth = elemDepth
    elemDepth--
    if (skipUntilDepth >= 0) {
      if (closingDepth === skipUntilDepth) skipUntilDepth = -1
      return
    }

    const ns = nsOf(tag.uri)
    const local = tag.local
    const ctx = stack[stack.length - 1]

    if (ns === 'gml') {
      if ((local === 'posList' || local === 'pos') && capture) {
        capture = false
        if (ring) ring.push(...parseCoords(text, srsDimension))
        return
      }
      if (local === 'LinearRing' && ring && polygon && ringTarget) {
        if (ringTarget === 'exterior') polygon.exterior = ring
        else polygon.interiors.push(ring)
        ring = null
        ringTarget = null
        return
      }
      if (local === 'LineString' && ring && inTerrain) {
        if (ring.length >= 6) ctx?.terrainIntersection.push(ring)
        ring = null
        ringTarget = null
        return
      }
      if (local === 'Polygon' && polygon) {
        if (polygon.exterior.length >= 9) {
          if (surface) surface.polygons.push(polygon)
          else ctx?.looseGeometry.push(polygon)
        }
        polygon = null
        return
      }
      return
    }

    if (ns === 'gen') {
      if (local === 'value' && capture) {
        capture = false
        if (ctx && genAttrName) ctx.attributes[genAttrName] = text.trim()
        return
      }
      if (local.endsWith('Attribute')) {
        genAttrName = null
        return
      }
    }

    if (ns === 'xal' && inAddress && capture) {
      capture = false
      const a = ctx?.address
      if (a) {
        const v = text.trim()
        if (local === 'ThoroughfareName') a.street = v
        else if (local === 'BuildingNumber') a.houseNumber = v
        else if (local === 'PostalCodeNumber') a.postcode = v
        else if (local === 'LocalityName') a.city = v
        else if (local === 'CountryName') a.country = v
      }
      genAttrName = null
      return
    }

    if (ns === 'core' && local === 'creationDate' && capture) {
      capture = false
      if (ctx) ctx.creationDate = text.trim()
      return
    }

    if (ns === 'bldg') {
      if (local === 'boundedBy') {
        inBoundedBy = false
        return
      }
      if (SURFACE_KINDS[local] && surface) {
        if (surface.polygons.length) ctx?.surfaces.push(surface)
        surface = null
        return
      }
      if (local === 'address') {
        inAddress = false
        return
      }
      if (capture) {
        capture = false
        const v = text.trim()
        if (!ctx) return
        if (local === 'function') ctx.functionCode = v
        else if (local === 'roofType') ctx.roofTypeCode = v
        else if (local === 'measuredHeight') ctx.measuredHeight = Number(v)
        else if (local === 'storeysAboveGround') ctx.storeysAboveGround = Number(v)
        else if (local === 'storeysBelowGround') ctx.storeysBelowGround = Number(v)
        return
      }
      if (local.startsWith(`lod${wantLod}`) && lodOf(local) !== null) {
        lodDepth = Math.max(0, lodDepth - 1)
        if (local === `lod${wantLod}TerrainIntersection`) inTerrain = false
        return
      }
      if (local === 'Building' || local === 'BuildingPart') {
        const done = stack.pop()
        if (!done) return
        if (done.isPart) summary.parts++
        else summary.buildings++
        // Loose polygons only become a surface if the file had no semantic ones.
        const surfaces = done.surfaces.length
          ? done.surfaces
          : done.looseGeometry.length
            ? [{ id: null, kind: 'unknown' as SurfaceKind, polygons: done.looseGeometry }]
            : []
        pending.push({
          gid: done.gid,
          parentGid: done.parentGid,
          isPart: done.isPart,
          creationDate: done.creationDate,
          functionCode: done.functionCode,
          roofTypeCode: done.roofTypeCode,
          measuredHeight: Number.isFinite(done.measuredHeight) ? done.measuredHeight : null,
          storeysAboveGround: Number.isFinite(done.storeysAboveGround) ? done.storeysAboveGround : null,
          storeysBelowGround: Number.isFinite(done.storeysBelowGround) ? done.storeysBelowGround : null,
          attributes: done.attributes,
          address: done.address,
          surfaces,
          terrainIntersection: done.terrainIntersection,
          srsName: summary.srsName,
          sourceTile: opts.sourceTile ?? null,
        })
      }
    }
  })

  let parseError: Error | null = null
  parser.on('error', (err: Error) => {
    parseError = err
  })

  for await (const chunk of input) {
    parser.write(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    if (parseError) throw parseError
    if (pending.length) {
      yield* pending.splice(0, pending.length)
    }
  }
  parser.close()
  if (parseError) throw parseError
  if (pending.length) yield* pending.splice(0, pending.length)
  return summary
}
