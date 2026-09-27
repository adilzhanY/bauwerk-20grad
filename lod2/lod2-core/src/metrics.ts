/**
 * Derived geometry for a single LoD2 building — the numbers an energy assessment
 * actually wants: roof area and orientation per plane, wall area, enclosed volume.
 *
 * A note on ClosureSurface: AdV uses it as a virtual lid where a building abuts a
 * neighbour or a part. It must be included when integrating volume and when checking
 * watertightness, but it is not real building fabric, so it never counts toward wall
 * or roof area. Conflating the two silently inflates envelope areas.
 */
import {
  isClosedSolid,
  newellNormal,
  polygonArea3d,
  polygonAreaProjected,
  polygonsExtent,
  ringVertexCount,
  solidVolume,
  tiltDeg,
  azimuthDeg,
  length as vlen,
} from './geometry.ts'
import { buriedAgainstRim, simplifyRing } from './terrain.ts'
import type {
  BuildingFlag,
  BuildingMesh,
  BuildingMetrics,
  Polygon,
  RawBuilding,
  RoofPlane,
  Surface,
  SurfaceKind,
} from './types.ts'

/**
 * Bump whenever parsing or metric computation changes in a way that alters stored
 * values, so already-ingested rows can be found and re-ingested. Version 2 fixed the
 * triangulation winding that made volumes for half of all solids meaningless; version 3
 * keeps the terrain-intersection curve, which had been parsed and thrown away.
 */
export const PIPELINE_VERSION = 3

/** Ground surfaces should be level; more spread than this is worth flagging. */
const GROUND_Z_SPREAD_M = 0.5
/** Tolerance when comparing our computed ridge height against `bldg:measuredHeight`. */
const HEIGHT_TOLERANCE_M = 0.5
const HEIGHT_TOLERANCE_REL = 0.1

/**
 * Classify a polygon by its outward normal, for states that ship geometry without
 * semantic surfaces. Roughly the rule AdV encodes: up-facing is roof, down-facing is
 * ground, near-vertical is wall.
 */
function classifyByNormal(poly: Polygon): SurfaceKind {
  const n = newellNormal(poly.exterior)
  if (vlen(n) < 1e-9) return 'unknown'
  const t = tiltDeg(n)
  if (t < 85) return 'roof'
  if (t > 95) return 'ground'
  return 'wall'
}

/** Split any `unknown` surfaces into per-kind buckets; pass semantic surfaces through. */
export function classifySurfaces(surfaces: Surface[]): Surface[] {
  const hasSemantic = surfaces.some((s) => s.kind !== 'unknown')
  if (hasSemantic) return surfaces
  const buckets = new Map<SurfaceKind, Polygon[]>()
  for (const s of surfaces) {
    for (const p of s.polygons) {
      const kind = classifyByNormal(p)
      const arr = buckets.get(kind) ?? []
      arr.push(p)
      buckets.set(kind, arr)
    }
  }
  return [...buckets].map(([kind, polygons]) => ({ id: null, kind, polygons }))
}

function isDegenerate(poly: Polygon): boolean {
  if (ringVertexCount(poly.exterior) < 3) return true
  return polygonArea3d(poly) < 1e-6
}

export function computeMetrics(building: RawBuilding): BuildingMetrics {
  const surfaces = classifySurfaces(building.surfaces)
  const flags: BuildingFlag[] = []
  const surfaceCounts: Record<SurfaceKind, number> = {
    wall: 0, roof: 0, ground: 0, closure: 0, unknown: 0,
  }

  const allPolygons: Polygon[] = []
  const roofPolys: Polygon[] = []
  const wallPolys: Polygon[] = []
  const groundPolys: Polygon[] = []
  let degenerate = false

  for (const s of surfaces) {
    surfaceCounts[s.kind] += 1
    for (const p of s.polygons) {
      if (isDegenerate(p)) {
        degenerate = true
        continue
      }
      allPolygons.push(p)
      if (s.kind === 'roof') roofPolys.push(p)
      else if (s.kind === 'wall') wallPolys.push(p)
      else if (s.kind === 'ground') groundPolys.push(p)
    }
  }

  const empty: BuildingMetrics = {
    footprintArea: 0, roofArea3d: 0, roofAreaProjected: 0, wallArea: 0, volume: 0,
    groundZ: null, minZ: null, maxZ: null, eaveHeight: null, ridgeHeight: null,
    buriedDepth: null, buriedWallArea: null,
    roofPlanes: [], surfaceCounts, flags: ['no-geometry'],
  }
  if (allPolygons.length === 0) return empty

  if (degenerate) flags.push('degenerate-polygon')
  if (groundPolys.length === 0) flags.push('no-ground-surface')
  if (roofPolys.length === 0) flags.push('no-roof-surface')

  const closed = isClosedSolid(allPolygons)
  if (!closed) flags.push('solid-not-closed')
  const volume = solidVolume(allPolygons)

  const footprintArea = groundPolys.reduce((s, p) => s + polygonAreaProjected(p), 0)
  const roofArea3d = roofPolys.reduce((s, p) => s + polygonArea3d(p), 0)
  const roofAreaProjected = roofPolys.reduce((s, p) => s + polygonAreaProjected(p), 0)
  const wallArea = wallPolys.reduce((s, p) => s + polygonArea3d(p), 0)

  const roofPlanes: RoofPlane[] = roofPolys.map((p, idx) => {
    const n = newellNormal(p.exterior)
    return {
      idx,
      area3d: polygonArea3d(p),
      areaProjected: polygonAreaProjected(p),
      azimuth: azimuthDeg(n),
      tilt: tiltDeg(n),
    }
  })

  const extent = polygonsExtent(allPolygons)
  const minZ = extent?.minZ ?? null
  const maxZ = extent?.maxZ ?? null

  // Ground height: mean of the ground-surface vertices, which AdV keeps level.
  let groundZ: number | null = null
  if (groundPolys.length) {
    let sum = 0
    let count = 0
    let gMin = Infinity
    let gMax = -Infinity
    for (const p of groundPolys) {
      for (let i = 2; i < p.exterior.length; i += 3) {
        const z = p.exterior[i]!
        sum += z
        count++
        if (z < gMin) gMin = z
        if (z > gMax) gMax = z
      }
    }
    if (count) {
      groundZ = sum / count
      if (gMax - gMin > GROUND_Z_SPREAD_M) flags.push('ground-z-spread')
    }
  } else if (minZ !== null) {
    groundZ = minZ
  }

  let eaveHeight: number | null = null
  let ridgeHeight: number | null = null
  if (roofPolys.length && groundZ !== null) {
    const rExtent = polygonsExtent(roofPolys)
    if (rExtent) {
      eaveHeight = rExtent.minZ - groundZ
      ridgeHeight = rExtent.maxZ - groundZ
    }
  } else if (groundZ !== null && maxZ !== null) {
    ridgeHeight = maxZ - groundZ
  }

  const measured = building.measuredHeight
  if (measured !== null && ridgeHeight !== null) {
    const tol = Math.max(HEIGHT_TOLERANCE_M, measured * HEIGHT_TOLERANCE_REL)
    if (Math.abs(ridgeHeight - measured) > tol) flags.push('height-mismatch')
  }

  if (closed && (volume <= 0 || (footprintArea > 0 && volume > footprintArea * 200))) {
    flags.push('implausible-volume')
  }

  const { buriedDepth, buriedWallArea } = buriedAgainstRim(building.terrainIntersection, groundZ)
  if (!building.terrainIntersection.length) flags.push('no-terrain-curve')

  return {
    footprintArea, roofArea3d, roofAreaProjected, wallArea, volume,
    groundZ, minZ, maxZ, eaveHeight, ridgeHeight, buriedDepth, buriedWallArea,
    roofPlanes, surfaceCounts, flags,
  }
}

/**
 * Rebase geometry to a local origin so the viewer can load it straight into a
 * BufferGeometry. UTM is metric already, so this is a translation and nothing else.
 */
export function buildMesh(building: RawBuilding, origin?: [number, number, number]): BuildingMesh {
  const surfaces = classifySurfaces(building.surfaces)
  const all = surfaces.flatMap((s) => s.polygons)
  const extent = polygonsExtent(all)
  const o: [number, number, number] = origin ?? (extent
    ? [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2, extent.minZ]
    : [0, 0, 0])

  const rebase = (ring: number[]): number[] => {
    const out: number[] = []
    for (let i = 0; i + 2 < ring.length; i += 3) {
      out.push(ring[i]! - o[0], ring[i + 1]! - o[1], ring[i + 2]! - o[2])
    }
    return out
  }

  const terrain = building.terrainIntersection
    .filter((ring) => ring.length >= 9)
    .map((ring) => simplifyRing(rebase(ring)))

  return {
    origin: o,
    // Omitted rather than empty where the state publishes none, so those payloads are
    // byte-identical to what they were before this existed.
    ...(terrain.length ? { terrain } : {}),
    surfaces: surfaces.map((s) => ({
      kind: s.kind,
      rings: s.polygons.flatMap((p) => [rebase(p.exterior), ...p.interiors.map(rebase)]),
    })),
  }
}

/**
 * Ground-surface polygons in the source CRS, for the 2D footprint.
 *
 * Returns polygons rather than a flat list of rings so the exterior/interior
 * distinction survives — WKT needs it, and flattening would turn courtyards into
 * separate outlines.
 */
export function footprintPolygons(building: RawBuilding): Polygon[] {
  const surfaces = classifySurfaces(building.surfaces)
  const ground = surfaces.filter((s) => s.kind === 'ground').flatMap((s) => s.polygons)
  if (ground.length) return ground
  // Fall back to the terrain-intersection curve when a state omits GroundSurface.
  return building.terrainIntersection
    .filter((ring) => ring.length >= 12)
    .map((ring) => ({ exterior: ring, interiors: [] }))
}

/** Well-known text for the footprint, in the source CRS. Null when there is none. */
export function footprintWkt(building: RawBuilding): string | null {
  const polys = footprintPolygons(building)
  if (!polys.length) return null
  const ringWkt = (r: number[]): string => {
    const pts: string[] = []
    for (let i = 0; i + 2 < r.length; i += 3) pts.push(`${r[i]} ${r[i + 1]}`)
    // WKT rings must close; CityGML rings already do, but a fallback ring may not.
    if (pts.length >= 3 && pts[0] !== pts[pts.length - 1]) pts.push(pts[0]!)
    return pts.length >= 4 ? `(${pts.join(',')})` : ''
  }
  const parts: string[] = []
  for (const p of polys) {
    const ext = ringWkt(p.exterior)
    if (!ext) continue
    const holes = p.interiors.map(ringWkt).filter(Boolean)
    parts.push(`(${[ext, ...holes].join(',')})`)
  }
  return parts.length ? `MULTIPOLYGON(${parts.join(',')})` : null
}
