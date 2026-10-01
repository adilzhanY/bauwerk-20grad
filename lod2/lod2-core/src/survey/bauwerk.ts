/**
 * One LoD2 building part plus what was measured on its photos, as a Bauwerk building.
 *
 * Bauwerk (github.com/adilzhanY/bauwerk) is the browser editor where an energy consultant
 * checks and corrects the model and reads the heating demand. This file writes its JSON
 * format directly, so nothing here depends on the editor's code. Every value carries a
 * source, so the consultant can see what was measured, what was assumed, and what to check.
 */
import type { BuildingDetail } from '../api.ts'
import { wallGroundLevel, wallToPlane } from '../wall.ts'
import { ageClassById, type AgeClassId } from './ageclass.ts'
import {
  planFrameFor,
  polygonArea,
  ringToPlan,
  simplifyFootprint,
  toPlan,
  type PlanFrame,
  type Vec2,
} from './footprint.ts'
import { placeOpenings, type MeasuredOpening, type PlacedOpening } from './placeopenings.ts'
import { catalogueWindows } from './defaultwindows.ts'
import { germanNote, germanText, message, type SurveyMessage } from './messages.ts'
import { editorRoof } from './roof.ts'
import { sharedEdges } from './sharedwalls.ts'
import { estimateStoreys, storeyHeights, storeysFromOpenings } from './storeys.ts'
import { utmToLatLon } from './utm.ts'

// ---------------------------------------------------------------------------------------
// The part of Bauwerk's file format this writes. Kept here on purpose, see the file comment.

export interface BauwerkOpening {
  id: string
  wallIndex: number
  kind: 'window' | 'door'
  offset: number
  width: number
  height: number
  sill: number
  constructionId: string
}

export interface BauwerkStorey {
  id: string
  name: string
  height: number
  openings: BauwerkOpening[]
  interiorWalls: never[]
  rooms: never[]
}

export interface BauwerkConstruction {
  id: string
  name: string
  category: 'wall' | 'window' | 'door' | 'floor' | 'roof'
  uValue: number
}

export type SourceKind = 'lod2' | 'photo' | 'catalogue' | 'estimate' | 'typed'

/** Where one value of the building came from. */
export interface ValueSource {
  kind: SourceKind
  /** What was assumed or changed on the way, in German. */
  note?: string
  /** The note as message keys with values (messages.ts), so the editor can show it in its language. */
  messages?: SurveyMessage[]
  /** File name of the photo a measured value was read from. */
  photo?: string
  /**
   * The value as it was written, in a short canonical form (see `sourceValue`). The editor
   * compares it with the current value: while they match, this source still holds; once
   * the consultant changes the value, the editor shows it as edited.
   */
  value?: (number | string)[]
}

export interface BauwerkBuilding {
  id: string
  name: string
  footprint: Vec2[]
  wallThickness: number
  storeys: BauwerkStorey[]
  zones: { id: string; name: string; color: string; heated: boolean; temperature: number }[]
  constructions: BauwerkConstruction[]
  wallConstructionId: string
  floorConstructionId: string
  roofConstructionId: string
  windowConstructionId: string
  doorConstructionId: string
  origin: { lat: number; lon: number; rotation: number }
  bridgeDetail: 'good' | 'poor'
  roof: { kind: 'flat' | 'gable' | 'hip'; pitch: number; overhang: number; ridgeAxis: 'x' | 'y'; parapet: number; heatedAttic: boolean }
  /** Footprint edges that lie against a heated neighbour. */
  sharedEdges: number[]
  /** Value path to source: "footprint", "storeys", "roof", "constructions", "opening:<id>". */
  sources: Record<string, ValueSource>
}

export interface BauwerkFile {
  format: 'bauwerk'
  version: 1
  building: BauwerkBuilding
}

// ---------------------------------------------------------------------------------------
// Input and report

export interface SurveyedWall {
  /** Index of the wall surface in the part's mesh. */
  surfaceIndex: number
  openings: MeasuredOpening[]
  /** How the openings were found. */
  method: 'detected' | 'drawn'
  photo?: string
}

export interface SurveyFacts {
  ageClass: AgeClassId
  /** True when the user chose the age class; false when it is the default guess. */
  ageClassConfirmed: boolean
  /** Storey count typed by the user; estimated from the height when missing. */
  storeys?: number
}

/** A neighbouring footprint: the ground rings of a mesh and that mesh's origin. */
export interface NeighbourFootprint {
  origin: readonly number[]
  grounds: readonly (readonly number[])[]
}

export interface SurveyInput {
  building: BuildingDetail
  partGid: string
  facts: SurveyFacts
  walls: readonly SurveyedWall[]
  /** Footprints of the buildings around. The other parts of the same building are added. */
  neighbours: readonly NeighbourFootprint[]
  /** UTM zone of the source coordinates, 33 for Berlin. */
  utmZone: number
  /**
   * Give every facade without a photo the default windows of the official survey rule, so
   * the energy balance is realistic before any photo is taken. Off by default.
   */
  fillMissingWindows?: boolean
}

export interface SurveyReport {
  /** Things the consultant should look at; `germanText` reads one in German. */
  warnings: SurveyMessage[]
  /** Openings that could not be placed, per wall. */
  dropped: { surfaceIndex: number; reason: string }[]
  openingCount: number
  openingArea: number
  /** Openings added by the default rule for facades without a photo. */
  catalogueOpenings: number
  eaveAboveStreet: number
  storeysEstimated: number
}

export type SurveyResult =
  | { ok: true; file: BauwerkFile; report: SurveyReport }
  | { ok: false; reason: string; message: SurveyMessage }

/** Taller than this and a storey is probably two, with one row of windows not seen. */
const TALL_STOREY_M = 4.2
const WALL_THICKNESS_OLD_M = 0.4
const WALL_THICKNESS_M = 0.3
const ROOF_OVERHANG_M = 0.3
const FLAT_PARAPET_M = 0.3
const HEATED_ZONE = { id: 'zone-heated', name: 'Beheizt', color: '#d9803f', heated: true, temperature: 20 }

const STOREY_NAMES = ['Erdgeschoss', '1. Obergeschoss', '2. Obergeschoss', '3. Obergeschoss', '4. Obergeschoss', '5. Obergeschoss', '6. Obergeschoss', '7. Obergeschoss']

export function storeyName(index: number): string {
  return STOREY_NAMES[index] ?? `${index}. Obergeschoss`
}

// ---------------------------------------------------------------------------------------

/** The Bauwerk file for one surveyed part, or the reason there is none. */
export function surveyToBauwerk(input: SurveyInput): SurveyResult {
  const part = input.building.parts.find((p) => p.gid === input.partGid)
  const mesh = part?.mesh
  if (!part || !mesh) return failed('survey.failed.noGeometry')
  const ground = mesh.surfaces.find((s) => s.kind === 'ground' && s.rings[0])
  if (!ground) return failed('survey.failed.noGround')

  const warnings: SurveyMessage[] = []
  const sources: Record<string, ValueSource> = {}
  const age = ageClassById(input.facts.ageClass)

  // Footprint in the plan frame.
  const meshFootprint = simplifyFootprint(ringToPlan(ground.rings[0]!))
  if (meshFootprint.length < 3) return failed('survey.failed.tooSmall')
  const frame = planFrameFor(meshFootprint)
  const footprint = meshFootprint.map((p) => roundPoint(toPlan(frame, p)))
  sources.footprint = source('lod2', message('survey.footprint', { corners: meshFootprint.length, area: round1(polygonArea(footprint)) }))

  // Heights from the street, not from the model's floor slab.
  const street = wallGroundLevel(ground.rings[0]!, mesh.terrain ?? []) ?? 0
  if (street === 0 && !(mesh.terrain ?? []).length) warnings.push(message('survey.warning.noTerrain'))
  const eave = part.eaveHeight ?? part.measuredHeight ?? 0
  const eaveAboveStreet = Math.max(2, eave - street)
  const estimated = estimateStoreys(eaveAboveStreet, age.storeyHeight)
  const fromPhoto = storeysFromPhotos(input.walls, mesh, street, eaveAboveStreet)
  let heights: number[]
  if (input.facts.storeys) {
    heights = storeyHeights(eaveAboveStreet, input.facts.storeys)
    sources.storeys = source('typed', message('survey.storeys.typed', { count: input.facts.storeys }))
    if (fromPhoto && fromPhoto.heights.length !== input.facts.storeys) {
      warnings.push(message('survey.warning.storeyMismatch', { rows: fromPhoto.heights.length, count: input.facts.storeys }))
    }
  } else if (fromPhoto) {
    heights = fromPhoto.heights
    sources.storeys = { ...source('photo', message('survey.storeys.photo', { count: heights.length })), photo: fromPhoto.photo }
  } else {
    heights = storeyHeights(eaveAboveStreet, estimated)
    sources.storeys = source('estimate', message('survey.storeys.estimated', { count: estimated, height: Math.round(eaveAboveStreet * 100) / 100 }))
  }

  const tall = heights.filter((h) => h > TALL_STOREY_M).length
  if (tall > 0) warnings.push(message('survey.warning.tallStoreys', { count: tall, height: TALL_STOREY_M }))

  // Roof.
  const rise = Math.max(0, (part.ridgeHeight ?? eave) - eave)
  const roof = editorRoof(part.roofTypeCode, rise, footprint)
  const roofType = part.roofTypeCode && part.roofTypeLabel ? message('survey.roof.type', { roofType: part.roofTypeCode }) : message('survey.roof.unknown')
  sources.roof = source('lod2', roofType, ...roof.messages)

  // Shared walls against neighbours and the other parts of this building.
  const around = [...input.neighbours, ...siblingFootprints(input.building, part.gid)]
  const neighbourPlans = around.flatMap((n) => n.grounds.map((ring) => ringToPlan(ring).map((p) =>
    toPlan(frame, { x: p.x + (n.origin[0]! - mesh.origin[0]!), y: p.y + (n.origin[1]! - mesh.origin[1]!) }))))
  const shared = sharedEdges(footprint, neighbourPlans).map((s) => s.edge)
  sources.sharedEdges = source('lod2', message('survey.sharedEdges', { count: shared.length }))

  // Constructions for the age class.
  const constructions = constructionsFor(input.facts.ageClass)
  const ageClass = { ageClass: age.id }
  sources.constructions = source('catalogue', message(input.facts.ageClassConfirmed ? 'survey.constructions' : 'survey.constructions.assumed', ageClass))
  if (!input.facts.ageClassConfirmed) warnings.push(message('survey.warning.ageClassAssumed', ageClass))

  // Openings, wall by wall.
  const storeys: BauwerkStorey[] = heights.map((height, index) => ({
    id: `storey-${index}`,
    name: storeyName(index),
    height,
    openings: [],
    interiorWalls: [],
    rooms: [],
  }))
  const dropped: SurveyReport['dropped'] = []
  let openingArea = 0
  const photographedEdges = new Set<number>()
  for (const wall of input.walls) {
    const ring = mesh.surfaces[wall.surfaceIndex]?.rings[0]
    if (!ring) {
      dropped.push({ surfaceIndex: wall.surfaceIndex, reason: 'Wand nicht mehr im Modell' })
      continue
    }
    const wallGround = wallGroundLevel(ring, mesh.terrain ?? [])
    const plane = wallToPlane(ring, wallGround ?? undefined)
    if (!plane) {
      dropped.push({ surfaceIndex: wall.surfaceIndex, reason: 'keine senkrechte Wand' })
      continue
    }
    const result = placeOpenings(wall.openings, plane, frame, footprint, heights, plane.origin[2] - street)
    if (result.edge !== null) photographedEdges.add(result.edge)
    for (const d of result.dropped) dropped.push({ surfaceIndex: wall.surfaceIndex, reason: d.reason })
    if (result.edge !== null && shared.includes(result.edge)) {
      warnings.push(message('survey.warning.partyWall', { wall: wall.surfaceIndex }))
      continue
    }
    for (const placed of result.placed) {
      const opening = toBauwerkOpening(placed, wall.surfaceIndex)
      storeys[placed.storey]!.openings.push(opening)
      openingArea += opening.width * opening.height
      sources[`opening:${opening.id}`] = openingSource(placed, wall)
    }
  }
  let catalogueOpenings = 0
  if (input.fillMissingWindows) {
    const added = addCatalogueWindows(storeys, footprint, shared, photographedEdges, sources)
    catalogueOpenings = added.count
    openingArea += added.area
  }
  for (const storey of storeys) storey.openings.sort((a, b) => a.wallIndex - b.wallIndex || a.offset - b.offset)

  // Placement on the map: the plan origin is the footprint's centroid.
  const center = { x: mesh.origin[0]! + frame.center.x, y: mesh.origin[1]! + frame.center.y }
  const latLon = utmToLatLon(center.x, center.y, input.utmZone)

  const oldStock = ['bis1918', '1919-1948', '1949-1957'].includes(input.facts.ageClass)
  const building: BauwerkBuilding = {
    id: `lod2-${part.gid}`,
    name: `${input.building.functionLabel ?? 'Gebäude'} ${input.building.buildingGid}`,
    footprint,
    wallThickness: oldStock ? WALL_THICKNESS_OLD_M : WALL_THICKNESS_M,
    storeys,
    zones: [HEATED_ZONE],
    constructions,
    wallConstructionId: 'lod2-wall',
    floorConstructionId: 'lod2-floor',
    roofConstructionId: 'lod2-roof',
    windowConstructionId: 'lod2-window',
    doorConstructionId: 'lod2-door',
    origin: { lat: round6(latLon.lat), lon: round6(latLon.lon), rotation: roundBearing(frame.bearing) },
    bridgeDetail: 'poor',
    roof: {
      kind: roof.kind,
      pitch: roof.pitch,
      overhang: roof.kind === 'flat' ? 0 : ROOF_OVERHANG_M,
      ridgeAxis: roof.ridgeAxis,
      parapet: roof.kind === 'flat' ? FLAT_PARAPET_M : 0,
      heatedAttic: false,
    },
    sharedEdges: shared,
    sources,
  }
  stampValues(building)
  if (input.walls.length === 0) warnings.push(message('survey.warning.noPhoto'))
  const otherParts = input.building.parts.filter((p) => p.hasGeometry && p.gid !== part.gid).length
  if (otherParts > 0) warnings.push(message('survey.warning.otherParts', { count: otherParts }))

  return {
    ok: true,
    file: { format: 'bauwerk', version: 1, building },
    report: {
      warnings,
      dropped,
      openingCount: storeys.reduce((n, s) => n + s.openings.length, 0),
      openingArea,
      catalogueOpenings,
      eaveAboveStreet,
      storeysEstimated: estimated,
    },
  }
}

/**
 * Storey heights from the photographed wall with the most openings, when its rows of windows
 * show them. Heights of the openings are measured from the part's street level.
 */
function storeysFromPhotos(
  walls: readonly SurveyedWall[],
  mesh: NonNullable<BuildingDetail['parts'][number]['mesh']>,
  street: number,
  eaveAboveStreet: number,
): { heights: number[]; photo?: string } | null {
  const sorted = [...walls].sort((a, b) => b.openings.length - a.openings.length)
  for (const wall of sorted) {
    const ring = mesh.surfaces[wall.surfaceIndex]?.rings[0]
    if (!ring) continue
    const plane = wallToPlane(ring, wallGroundLevel(ring, mesh.terrain ?? []) ?? undefined)
    if (!plane) continue
    const base = plane.origin[2] - street
    const spans = wall.openings.map((o) => ({ bottom: o.y + base, top: o.y + o.height + base }))
    const heights = storeysFromOpenings(spans, eaveAboveStreet)
    if (heights) return wall.photo ? { heights, photo: wall.photo } : { heights }
  }
  return null
}

/**
 * The canonical value behind a source path, the same form the editor computes to tell an
 * unchanged value from an edited one:
 *
 *   footprint      x0, y0, x1, y1, ... in metres
 *   storeys        the storey heights, ground floor first
 *   roof           kind, pitch, ridge axis
 *   constructions  U of the assigned wall, roof, floor, window and door construction
 *   sharedEdges    the shared edge indexes
 *   opening:<id>   wall index, kind, offset, width, height, sill
 *
 * Null for a path the building does not have (a deleted opening).
 */
export function sourceValue(building: BauwerkBuilding, path: string): (number | string)[] | null {
  if (path === 'footprint') return building.footprint.flatMap((p) => [p.x, p.y])
  if (path === 'storeys') return building.storeys.map((s) => s.height)
  if (path === 'roof') return [building.roof.kind, building.roof.pitch, building.roof.ridgeAxis]
  if (path === 'sharedEdges') return [...building.sharedEdges]
  if (path === 'constructions') {
    const u = (id: string) => building.constructions.find((c) => c.id === id)?.uValue ?? 0
    return [building.wallConstructionId, building.roofConstructionId, building.floorConstructionId, building.windowConstructionId, building.doorConstructionId].map(u)
  }
  if (path.startsWith('opening:')) {
    const id = path.slice('opening:'.length)
    const opening = building.storeys.flatMap((s) => s.openings).find((o) => o.id === id)
    return opening ? [opening.wallIndex, opening.kind, opening.offset, opening.width, opening.height, opening.sill] : null
  }
  return null
}

function stampValues(building: BauwerkBuilding): void {
  for (const [path, source] of Object.entries(building.sources)) {
    const value = sourceValue(building, path)
    if (value) source.value = value
  }
}

/**
 * The default windows of the official rule on every facade that has no photo and is not a
 * party wall, marked as catalogue values so the editor shows where they came from.
 */
function addCatalogueWindows(
  storeys: BauwerkStorey[],
  footprint: readonly Vec2[],
  shared: readonly number[],
  photographed: ReadonlySet<number>,
  sources: Record<string, ValueSource>,
): { count: number; area: number } {
  let count = 0
  let area = 0
  footprint.forEach((a, edge) => {
    if (shared.includes(edge) || photographed.has(edge)) return
    const b = footprint[(edge + 1) % footprint.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    storeys.forEach((storey, storeyIndex) => {
      catalogueWindows(length, storey.height).forEach((w, k) => {
        const id = `c${edge}-s${storeyIndex}-${k}`
        storey.openings.push({ id, wallIndex: edge, kind: 'window', offset: w.offset, width: w.width, height: w.height, sill: w.sill, constructionId: 'lod2-window' })
        sources[`opening:${id}`] = source('catalogue', message('survey.opening.catalogue'))
        count++
        area += w.width * w.height
      })
    })
  })
  return { count, area }
}

/** The ground rings of the building's other parts, as neighbours. */
function siblingFootprints(building: BuildingDetail, partGid: string): NeighbourFootprint[] {
  return building.parts
    .filter((p) => p.gid !== partGid && p.mesh)
    .map((p) => ({
      origin: p.mesh!.origin,
      grounds: p.mesh!.surfaces.filter((s) => s.kind === 'ground' && s.rings[0]).map((s) => s.rings[0]!),
    }))
}

export function constructionsFor(ageClass: AgeClassId): BauwerkConstruction[] {
  const age = ageClassById(ageClass)
  return [
    { id: 'lod2-wall', name: age.names.wall, category: 'wall', uValue: age.u.wall },
    { id: 'lod2-roof', name: age.names.roof, category: 'roof', uValue: age.u.roof },
    { id: 'lod2-floor', name: age.names.floor, category: 'floor', uValue: age.u.floor },
    { id: 'lod2-window', name: age.names.window, category: 'window', uValue: age.u.window },
    { id: 'lod2-door', name: age.names.door, category: 'door', uValue: age.u.door },
  ]
}

function toBauwerkOpening(placed: PlacedOpening, surfaceIndex: number): BauwerkOpening {
  return {
    // Stable: the same wall and the same measured opening give the same id on every export.
    id: `w${surfaceIndex}-o${placed.source}`,
    wallIndex: placed.edge,
    kind: placed.kind,
    offset: placed.offset,
    width: placed.width,
    height: placed.height,
    sill: placed.sill,
    constructionId: placed.kind === 'door' ? 'lod2-door' : 'lod2-window',
  }
}

function openingSource(placed: PlacedOpening, wall: SurveyedWall): ValueSource {
  const how = wall.method === 'drawn'
    ? message('survey.opening.drawn')
    : placed.score === undefined
      ? message('survey.opening.detected')
      : message('survey.opening.detectedScore', { confidence: Math.round(placed.score * 100) })
  const result = source('photo', how, ...placed.messages)
  return wall.photo ? { ...result, photo: wall.photo } : result
}

/** A source whose note is these messages, in German and as keys. */
function source(kind: SourceKind, ...messages: SurveyMessage[]): ValueSource {
  return { kind, note: germanNote(messages), messages }
}

function failed(key: SurveyMessage['key']): SurveyResult {
  const m = message(key)
  return { ok: false, reason: germanText(m), message: m }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function roundPoint(p: Vec2): Vec2 {
  return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

/** A bearing in [0, 360) with one decimal, as the editor requires. */
function roundBearing(bearing: number): number {
  const rounded = Math.round(bearing * 10) / 10
  return rounded >= 360 ? 0 : rounded
}

export type { PlanFrame }
