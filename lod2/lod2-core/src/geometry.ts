/**
 * Geometry primitives for LoD2 solids.
 *
 * Everything here works on flat, closed rings of [x, y, z, ...] in a metric CRS.
 * Nothing is projected: UTM coordinates are already metres, so areas and volumes
 * come out in m² / m³ directly.
 */
import earcut from 'earcut'
import type { Polygon } from './types.ts'

export type Vec3 = [number, number, number]

const EPS = 1e-9
const RAD2DEG = 180 / Math.PI

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

export function normalize(v: Vec3): Vec3 {
  const l = length(v)
  return l < EPS ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l]
}

/** Number of distinct vertices in a closed ring (i.e. excluding the repeated last point). */
export function ringVertexCount(ring: number[]): number {
  const n = Math.floor(ring.length / 3)
  if (n < 2) return n
  const closed =
    Math.abs(ring[0]! - ring[(n - 1) * 3]!) < 1e-6 &&
    Math.abs(ring[1]! - ring[(n - 1) * 3 + 1]!) < 1e-6 &&
    Math.abs(ring[2]! - ring[(n - 1) * 3 + 2]!) < 1e-6
  return closed ? n - 1 : n
}

/**
 * Newell's method. Robust for non-convex and slightly non-planar polygons, which
 * matters because LoD2 roof faces are only approximately planar after rounding.
 *
 * The result is NOT normalised — its magnitude is twice the polygon's area, which
 * is exactly what `ringArea3d` wants.
 */
export function newellNormal(ring: number[]): Vec3 {
  const n = ringVertexCount(ring)
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = ring[i * 3]!
    const ay = ring[i * 3 + 1]!
    const az = ring[i * 3 + 2]!
    const bx = ring[j * 3]!
    const by = ring[j * 3 + 1]!
    const bz = ring[j * 3 + 2]!
    nx += (ay - by) * (az + bz)
    ny += (az - bz) * (ax + bx)
    nz += (ax - bx) * (ay + by)
  }
  return [nx / 2, ny / 2, nz / 2]
}

/** True 3D area of a single closed ring, m². */
export function ringArea3d(ring: number[]): number {
  return length(newellNormal(ring))
}

/** Area of the ring's projection onto the horizontal plane, m². */
export function ringAreaProjected(ring: number[]): number {
  return Math.abs(newellNormal(ring)[2])
}

/** Polygon area with interior rings subtracted. */
export function polygonArea3d(poly: Polygon): number {
  let a = ringArea3d(poly.exterior)
  for (const hole of poly.interiors) a -= ringArea3d(hole)
  return Math.max(a, 0)
}

export function polygonAreaProjected(poly: Polygon): number {
  let a = ringAreaProjected(poly.exterior)
  for (const hole of poly.interiors) a -= ringAreaProjected(hole)
  return Math.max(a, 0)
}

/**
 * Angle between the surface normal and straight up, in degrees.
 * 0 = horizontal facing up, 90 = vertical, 180 = horizontal facing down.
 *
 * AdV orients outward normals, so roof faces land in 0..90 and ground faces near 180.
 * A roof reporting >90 means the source winding is reversed.
 */
export function tiltDeg(normal: Vec3): number {
  const l = length(normal)
  if (l < EPS) return 0
  return Math.acos(Math.min(1, Math.max(-1, normal[2] / l))) * RAD2DEG
}

/**
 * Compass bearing the face looks toward: 0 = grid north (+y), 90 = east (+x).
 * Null for horizontal faces, where a bearing is meaningless.
 *
 * Note this is *grid* north (UTM), not true north. Meridian convergence in Germany
 * reaches ~2-3° at the zone edges; correct for it only if that ever matters.
 */
export function azimuthDeg(normal: Vec3): number | null {
  const h = Math.hypot(normal[0], normal[1])
  if (h < 1e-6) return null
  const deg = Math.atan2(normal[0], normal[1]) * RAD2DEG
  return (deg + 360) % 360
}

/**
 * Triangulate a polygon by dropping its dominant axis and running earcut in 2D.
 * Axis pairs are chosen so the projection preserves winding sign.
 *
 * Returns triangles as flat 3D vertex triples, ready for both volume integration
 * and a BufferGeometry.
 */
export function triangulatePolygon(poly: Polygon): { positions: number[]; indices: number[] } {
  const normal = newellNormal(poly.exterior)
  const ax = Math.abs(normal[0])
  const ay = Math.abs(normal[1])
  const az = Math.abs(normal[2])

  // Pick the two axes that survive the projection, keeping a right-handed pair so the
  // 2D signed area carries the same sign as the dropped normal component.
  let i0: number
  let i1: number
  let dropped: number
  if (az >= ax && az >= ay) {
    i0 = 0
    i1 = 1
    dropped = 2 // drop z -> (x, y)
  } else if (ax >= ay) {
    i0 = 1
    i1 = 2
    dropped = 0 // drop x -> (y, z)
  } else {
    i0 = 2
    i1 = 0
    dropped = 1 // drop y -> (z, x)
  }

  const positions: number[] = []
  const flat2d: number[] = []
  const holeIndices: number[] = []

  const pushRing = (ring: number[], isHole: boolean) => {
    const n = ringVertexCount(ring)
    if (n < 3) return
    if (isHole) holeIndices.push(positions.length / 3)
    for (let i = 0; i < n; i++) {
      const x = ring[i * 3]!
      const y = ring[i * 3 + 1]!
      const z = ring[i * 3 + 2]!
      positions.push(x, y, z)
      const c = [x, y, z]
      flat2d.push(c[i0]!, c[i1]!)
    }
  }

  pushRing(poly.exterior, false)
  for (const hole of poly.interiors) pushRing(hole, true)

  if (positions.length < 9) return { positions, indices: [] }
  const indices = earcut(flat2d, holeIndices.length ? holeIndices : undefined, 2)

  // earcut always emits counter-clockwise triangles in the 2D projection, discarding
  // the input ring's winding. In 3D that silently flips every face whose normal points
  // down the dropped axis — half the faces of any closed solid — which destroys the
  // orientation that volume integration depends on. Restore it here, at the source, so
  // renderers get correct outward normals too.
  if ((normal[dropped] ?? 0) < 0) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const swap = indices[t + 1]!
      indices[t + 1] = indices[t + 2]!
      indices[t + 2] = swap
    }
  }
  return { positions, indices }
}

/**
 * Enclosed volume of a closed, outward-oriented triangle soup, via the divergence
 * theorem: V = 1/6 * sum over triangles of v0 . (v1 x v2).
 *
 * Returns the absolute value, so a uniformly inward-wound solid still yields a
 * positive volume. Callers should consult `isClosedSolid` before trusting the number
 * at all — an open solid produces a plausible-looking but meaningless value.
 */
export function solidVolume(polygons: Polygon[]): number {
  // The integral is origin-independent in exact arithmetic, but not in float64: with raw
  // UTM coordinates (x ~ 3e5, y ~ 5.7e6) each term reaches ~1e11 while the answer is ~1e2,
  // so the sum is pure cancellation noise. Rebasing to a corner of the solid's own extent
  // keeps every term the same order of magnitude as the result.
  const extent = polygonsExtent(polygons)
  if (!extent) return 0
  const ox = extent.minX
  const oy = extent.minY
  const oz = extent.minZ

  let v6 = 0
  for (const poly of polygons) {
    const { positions, indices } = triangulatePolygon(poly)
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t]! * 3
      const b = indices[t + 1]! * 3
      const c = indices[t + 2]! * 3
      const v0: Vec3 = [positions[a]! - ox, positions[a + 1]! - oy, positions[a + 2]! - oz]
      const v1: Vec3 = [positions[b]! - ox, positions[b + 1]! - oy, positions[b + 2]! - oz]
      const v2: Vec3 = [positions[c]! - ox, positions[c + 1]! - oy, positions[c + 2]! - oz]
      v6 += dot(v0, cross(v1, v2))
    }
  }
  return Math.abs(v6) / 6
}

/**
 * A watertight solid uses every edge exactly twice. Coordinates are snapped to the
 * millimetre before comparison because the source data is text with ~3 decimals.
 */
export function isClosedSolid(polygons: Polygon[]): boolean {
  const uses = new Map<string, number>()
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`

  const addRing = (ring: number[]) => {
    const n = ringVertexCount(ring)
    if (n < 3) return
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ka = key(ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!)
      const kb = key(ring[j * 3]!, ring[j * 3 + 1]!, ring[j * 3 + 2]!)
      if (ka === kb) continue
      const edge = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      uses.set(edge, (uses.get(edge) ?? 0) + 1)
    }
  }

  for (const poly of polygons) {
    addRing(poly.exterior)
    for (const hole of poly.interiors) addRing(hole)
  }
  if (uses.size === 0) return false
  for (const count of uses.values()) if (count !== 2) return false
  return true
}

export interface Extent {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export function polygonsExtent(polygons: Polygon[]): Extent | null {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let seen = false
  for (const poly of polygons) {
    for (const ring of [poly.exterior, ...poly.interiors]) {
      for (let i = 0; i + 2 < ring.length; i += 3) {
        const x = ring[i]!
        const y = ring[i + 1]!
        const z = ring[i + 2]!
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
        seen = true
      }
    }
  }
  return seen ? { minX, minY, minZ, maxX, maxY, maxZ } : null
}

/**
 * UV for a point under a top-down orthophoto.
 *
 * An orthophoto is a parallel projection straight down in the same CRS as the geometry,
 * so a vertex's texture coordinate is simply its position within the image's bbox. `v`
 * counts north-positive; whether the sampler needs it flipped depends on the image's row
 * order, which is a renderer concern rather than a geometric one.
 *
 * Clamped to [0,1]: a vertex just outside the requested bbox should smear the edge pixel,
 * not wrap around to the opposite side of the image.
 */
export function orthoUv(
  x: number,
  y: number,
  bbox: readonly [number, number, number, number],
): [number, number] {
  const [minX, minY, maxX, maxY] = bbox
  const w = maxX - minX
  const h = maxY - minY
  if (w <= 0 || h <= 0) return [0, 0]
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  return [clamp((x - minX) / w), clamp((y - minY) / h)]
}
