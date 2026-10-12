/**
 * A ground surface warped to the terrain the building model already knows.
 *
 * LoD2 carries `bldg:lod2TerrainIntersection` (the line where a building's walls meet the
 * ground), and it is the only height information in the data. There is no terrain model here:
 * heights exist along building walls and nowhere else, so everything between them is an
 * interpolation. That is honest as a picture of the ground and must not be read as a survey.
 *
 * The design turns on one fact about how the result is drawn: the orthophoto's UV is a
 * function of x and y alone (`orthoUv`) and the material is unlit, so two surfaces overlapping
 * in plan view produce *identical pixels* whatever their heights. Overlap is therefore free,
 * which is what lets an exactly-placed collar meet a coarse grid without stitching them:
 * no constrained triangulation, no new dependency.
 */
import { orthoUv } from './geometry.ts'
import type { BBox } from './types.ts'

/** Finest grid cell in metres. Curve vertices are ~2.4 m apart, so finer only interpolates harder. */
export const TERRAIN_CELL_M = 2
/**
 * Most cells across the surface, whatever it spans.
 *
 * The cell size has to follow the extent, not be fixed: at 300 m a 2 m cell is 1/150 of the
 * view and worth having, but holding it at 800 m means 160,000 vertices and one and a half
 * seconds of blocked main thread for detail nobody can see. The collar is unaffected either
 * way: it is built from the contact line itself, so the ground stays exact at the walls
 * however coarse the field behind it is.
 */
const TERRAIN_MAX_CELLS = 200
/** How far the collar reaches before it has fully blended into the interpolated field. */
const COLLAR_REACH_M = 8
/** Rings between the curve and the field. Three is enough for the blend to look continuous. */
const COLLAR_RINGS = 3
/**
 * Arc length within which a segment counts as this vertex's own neighbourhood.
 *
 * Below this the ring is simply continuing, and its distance says nothing about folding.
 */
const LOCAL_FEATURE_WINDOW_M = 1.5
/** How far the collar runs past the blend, purely to overlap the grid rather than meet it. */
const APRON_M = 2 * TERRAIN_CELL_M
/** Millimetres of lift on the blended collar, so an overlap resolves the same way every frame. */
const COLLAR_LIFT_M = 0.01
/** Constraints are averaged into cells this size, so one large building cannot dominate. */
const DECLUSTER_M = 2
/** Bucket size for the nearest-neighbour index. */
const BUCKET_M = 8
/**
 * Bucket size for the footprint index, in metres.
 *
 * Comfortably larger than a house, so a typical ring lands in one or two buckets, and small
 * enough that a bucket holds only a few rings.
 */
const RING_INDEX_M = 25
/** How many neighbours the inverse-distance weighting uses. */
const IDW_NEIGHBOURS = 10
/**
 * Below this many constraints, scan them all instead of searching the bucket grid.
 *
 * The two strategies have opposite failure modes. A ring search is O((d/cell)²) in the
 * distance to the nearest constraint, which is unbeatable when the cloud is dense and
 * ruinous when it is not. A flat scan is O(n) regardless of distance.
 *
 * The sparse case is not hypothetical, it is the common one: every selection builds the
 * ground once from the selected building's own contact line alone, before its neighbours
 * have arrived: a few dozen points against a grid covering the whole 800 m context box, so
 * almost every probe is hundreds of metres from anything. Measured in Chrome, that single
 * pass took 20.8 seconds; the same grid with the neighbours' 1,223 rings took 485 ms.
 *
 * 2048 is well above any single building's contact line and well below the point where a
 * scan would cost more than the search it replaces.
 */
const LINEAR_SCAN_MAX = 2048
/** Below this distance a query point *is* the constraint, and takes its height exactly. */
const EXACT_EPS_M = 1e-6

export interface TerrainMesh {
  /** xyz triples, rebased against the origin passed in, still z-up. */
  positions: Float32Array
  /** uv pairs, one per position. */
  uvs: Float32Array
  indices: Uint32Array
  /** Where the heights came from, so the UI can say. */
  source: 'exact' | 'dgm' | 'none'
  /** Vertices of the building's own contact line that the surface passes through exactly. */
  rimVertices: number
}

export interface TerrainInput {
  /** The orthophoto's own extent, in the source CRS. Anything else shifts the drape. */
  bbox: BBox
  /** Contact lines of the selected building: flat xyz, absolute coordinates. */
  rimRings: readonly number[][]
  /** Every contact-line vertex in view, the selection's and its neighbours'. */
  constraints: readonly number[][]
  /** Footprint rings to cut out, so terrain never covers a building. */
  holes: readonly number[][]
  /**
   * Heights from somewhere better than the contact lines: a real terrain model.
   *
   * When present it replaces the interpolation entirely: `constraints` then only decide
   * whether there is anything to warp at all. This is the seam a state DGM plugs into, and
   * the reason the interpolation was kept behind a single call.
   */
  field?: (x: number, y: number) => number
  /** Height to fall back to where nothing is known. */
  fallbackZ: number
  /** Subtracted from every emitted position. */
  origin: readonly [number, number, number]
  cellM?: number
}

// --- height field ---------------------------------------------------------------------

/**
 * Average constraints into cells.
 *
 * A single building contributes up to 560 curve vertices, all within a few metres. Left as
 * they are, that one building outvotes every other constraint nearby and the field develops a
 * plateau around it. Averaging first makes the sample density roughly uniform.
 */
export function declusterAverage(points: readonly number[][], cellM = DECLUSTER_M): number[][] {
  const cells = new Map<string, { x: number; y: number; z: number; n: number }>()
  for (const p of points) {
    const key = `${Math.floor(p[0]! / cellM)}:${Math.floor(p[1]! / cellM)}`
    const cell = cells.get(key)
    if (cell) {
      cell.x += p[0]!
      cell.y += p[1]!
      cell.z += p[2]!
      cell.n++
    } else {
      cells.set(key, { x: p[0]!, y: p[1]!, z: p[2]!, n: 1 })
    }
  }
  return [...cells.values()].map((c) => [c.x / c.n, c.y / c.n, c.z / c.n])
}

export interface BucketIndex {
  cellM: number
  buckets: Map<string, number[][]>
  points: readonly number[][]
  minZ: number
  maxZ: number
  meanZ: number
  /**
   * Bucket-coordinate extent of the occupied buckets.
   *
   * Lets `sampleHeight` stop as soon as its search square has swallowed every bucket that
   * holds anything, instead of grinding out to a fixed ring limit over empty space. Exact
   * rather than a heuristic: past that point there is provably nothing left to find.
   */
  minIx: number
  maxIx: number
  minIy: number
  maxIy: number
}

/** Uniform bucket grid. A kd-tree would be better asymptotically and worse at this size. */
export function bucketIndex(points: readonly number[][], cellM = BUCKET_M): BucketIndex {
  const buckets = new Map<string, number[][]>()
  let minZ = Infinity
  let maxZ = -Infinity
  let minIx = Infinity
  let maxIx = -Infinity
  let minIy = Infinity
  let maxIy = -Infinity
  for (const p of points) {
    const ix = Math.floor(p[0]! / cellM)
    const iy = Math.floor(p[1]! / cellM)
    const list = buckets.get(`${ix}:${iy}`)
    if (list) list.push(p as number[])
    else buckets.set(`${ix}:${iy}`, [p as number[]])
    if (p[2]! < minZ) minZ = p[2]!
    if (p[2]! > maxZ) maxZ = p[2]!
    if (ix < minIx) minIx = ix
    if (ix > maxIx) maxIx = ix
    if (iy < minIy) minIy = iy
    if (iy > maxIy) maxIy = iy
  }
  let sum = 0
  for (const p of points) sum += p[2]!
  return {
    cellM, buckets, points, minZ, maxZ,
    meanZ: points.length ? sum / points.length : 0,
    minIx, maxIx, minIy, maxIy,
  }
}

const meanZ = (index: BucketIndex) => index.meanZ

/**
 * Height at a point, by inverse-distance weighting over the nearest constraints.
 *
 * Searches outward in rings of buckets until it has enough candidates, then weights them by
 * `1/d²`. Exact at a constraint, which is what makes the collar's outer ring land on the field
 * rather than near it. Clamped to the constraint range so an extrapolated corner cannot invent
 * a height nothing in the data supports.
 */
/**
 * Inverse-distance weight a set of candidates, nearest `IDW_NEIGHBOURS` first.
 *
 * Shared by both search strategies so they cannot drift apart: exact at a constraint, which
 * is what makes the collar's outer ring land on the field rather than near it, and clamped to
 * the constraint range so an extrapolated corner cannot invent a height nothing supports.
 */
function idw(
  index: BucketIndex,
  candidates: Array<{ d2: number; z: number }>,
): number {
  candidates.sort((a, b) => a.d2 - b.d2)
  const use = candidates.slice(0, IDW_NEIGHBOURS)
  if (use[0]!.d2 <= EXACT_EPS_M * EXACT_EPS_M) return use[0]!.z

  let sum = 0
  let weight = 0
  for (const c of use) {
    const w = 1 / c.d2
    sum += w * c.z
    weight += w
  }
  const z = sum / weight
  return z < index.minZ ? index.minZ : z > index.maxZ ? index.maxZ : z
}

/**
 * The nearest `IDW_NEIGHBOURS` constraints by a flat scan, keeping a small sorted shortlist.
 *
 * No sort of the whole set and no allocation per point: with the shortlist full, a candidate
 * further than its worst member is rejected on one comparison, which is almost all of them.
 */
function nearestByScan(
  points: readonly number[][],
  x: number,
  y: number,
): Array<{ d2: number; z: number }> {
  const best: Array<{ d2: number; z: number }> = []
  let worst = Infinity
  for (const p of points) {
    const dx = p[0]! - x
    const dy = p[1]! - y
    const d2 = dx * dx + dy * dy
    if (best.length === IDW_NEIGHBOURS && d2 >= worst) continue
    let i = best.length
    while (i > 0 && best[i - 1]!.d2 > d2) i--
    best.splice(i, 0, { d2, z: p[2]! })
    if (best.length > IDW_NEIGHBOURS) best.pop()
    worst = best[best.length - 1]!.d2
  }
  return best
}

export function sampleHeight(index: BucketIndex, x: number, y: number, fallbackZ: number): number {
  if (!index.points.length) return fallbackZ

  // Small cloud: scanning it is both cheaper than searching a grid over it and exact, since
  // it cannot miss a nearer point that happens to sit in a later ring.
  if (index.points.length <= LINEAR_SCAN_MAX) {
    return idw(index, nearestByScan(index.points, x, y))
  }

  const cx = Math.floor(x / index.cellM)
  const cy = Math.floor(y / index.cellM)
  const found: Array<{ d2: number; z: number }> = []

  const visit = (ix: number, iy: number): void => {
    const list = index.buckets.get(`${ix}:${iy}`)
    if (!list) return
    for (const p of list) {
      const dx = p[0]! - x
      const dy = p[1]! - y
      found.push({ d2: dx * dx + dy * dy, z: p[2]! })
    }
  }

  /**
   * Outward ring search, visiting only the rim each time.
   *
   * Walking the rim rather than re-walking the whole square and skipping its interior is the
   * difference between O(R²) to reach ring R and O(R³). That sounds academic and is not: the
   * grid covers the whole context box, so a view containing a park, a rail cutting or a river
   * asks about thousands of points with no contact line for a couple of hundred metres, and
   * each of those used to run the search out to its limit. Measured on a Berlin view next to
   * Viktoriapark, this loop alone accounted for 52 of 63 seconds of blocked main thread.
   *
   * `maxRing` is still here as a backstop, but the extent check below is what normally ends
   * the search: once the square covers every occupied bucket, nothing further can be found.
   */
  const maxRing = 64
  for (let ring = 0; ring <= maxRing; ring++) {
    if (ring === 0) {
      visit(cx, cy)
    } else {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        visit(ix, cy - ring)
        visit(ix, cy + ring)
      }
      for (let iy = cy - ring + 1; iy <= cy + ring - 1; iy++) {
        visit(cx - ring, iy)
        visit(cx + ring, iy)
      }
    }
    // One extra ring after the first hit: the nearest bucket may hold a point that is
    // further away than one just over the boundary.
    if (found.length >= IDW_NEIGHBOURS && ring > 0) break
    if (found.length && ring > 0) break
    // Nothing left anywhere: the square now contains every occupied bucket.
    if (
      cx - ring <= index.minIx && cx + ring >= index.maxIx &&
      cy - ring <= index.minIy && cy + ring >= index.maxIy
    ) break
  }
  // Nothing within reach, but the data exists: the mean is the only honest answer, and it
  // is inside the range by construction.
  if (!found.length) return meanZ(index)
  return idw(index, found)
}

// --- rings ----------------------------------------------------------------------------

/** Whether a ring closes on itself, which decides if it can cut a hole. */
function isClosed(ring: readonly number[]): boolean {
  const n = ring.length
  if (n < 12) return false
  return Math.abs(ring[0]! - ring[n - 3]!) < 1e-6 && Math.abs(ring[1]! - ring[n - 2]!) < 1e-6
}

/** Even-odd test against a set of closed rings, so courtyards count as outside. */
/**
 * Rings bucketed by their bounding box, so a point test looks at a handful instead of all.
 *
 * The naive scan is quadratic in the worst way: an 800 m box holds ~2,000 footprints with
 * ~18,000 vertices between them, and the grid asks about 640,000 corners. That is eleven
 * billion segment tests, and it measured at 23 seconds.
 *
 * Filtering by bounding box is exact, not approximate: a closed ring whose box excludes the
 * point crosses a ray from it an even number of times, so it can never change the even-odd
 * answer. Dropping it early is the same result, reached sooner.
 */
export interface RingIndex {
  cellM: number
  buckets: Map<string, number[]>
  rings: readonly number[][]
}

export function buildRingIndex(rings: readonly number[][], cellM = RING_INDEX_M): RingIndex {
  const buckets = new Map<string, number[]>()
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i + 2 < ring.length; i += 3) {
      if (ring[i]! < minX) minX = ring[i]!
      if (ring[i]! > maxX) maxX = ring[i]!
      if (ring[i + 1]! < minY) minY = ring[i + 1]!
      if (ring[i + 1]! > maxY) maxY = ring[i + 1]!
    }
    if (!Number.isFinite(minX)) continue
    for (let iy = Math.floor(minY / cellM); iy <= Math.floor(maxY / cellM); iy++) {
      for (let ix = Math.floor(minX / cellM); ix <= Math.floor(maxX / cellM); ix++) {
        const key = `${ix}:${iy}`
        const list = buckets.get(key)
        if (list) list.push(r)
        else buckets.set(key, [r])
      }
    }
  }
  return { cellM, buckets, rings }
}

/** Even-odd test against an indexed ring set. Identical to `pointInRings`, without the scan. */
export function ringIndexContains(index: RingIndex, x: number, y: number): boolean {
  const list = index.buckets.get(`${Math.floor(x / index.cellM)}:${Math.floor(y / index.cellM)}`)
  if (!list) return false
  let inside = false
  for (const r of list) {
    const ring = index.rings[r]!
    for (let i = 0, j = ring.length - 3; i + 2 < ring.length; j = i, i += 3) {
      const yi = ring[i + 1]!
      const yj = ring[j + 1]!
      if ((yi > y) !== (yj > y) && x < ((ring[j]! - ring[i]!) * (y - yi)) / (yj - yi) + ring[i]!) {
        inside = !inside
      }
    }
  }
  return inside
}

export function pointInRings(rings: readonly number[][], x: number, y: number): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 3; i + 2 < ring.length; j = i, i += 3) {
      const xi = ring[i]!
      const yi = ring[i + 1]!
      const xj = ring[j]!
      const yj = ring[j + 1]!
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/**
 * Outward normals at each vertex, and how far each may be pushed before the offset folds.
 *
 * The cap is the local feature size (the distance to the nearest part of the ring that is not
 * an immediate neighbour), which is what stops the inside of a tight reflex corner crossing
 * itself when the ring is offset outward.
 */
/**
 * Outward normals for offsetting a contact line, and how far each vertex may be pushed.
 *
 * The cap is the fold guard. It is *local feature size* (the distance to the nearest part of
 * the ring that is not simply the continuation of this one), because that is what an offset
 * curve collides with when it folds: the far side of a notch, or the opposite wall of an alley.
 * Measuring to the nearest non-adjacent *vertex* instead looks similar and is not: on a curve
 * sampled every few centimetres the vertex two along is centimetres away, which caps every
 * offset to nothing and collapses the collar to a fringe.
 */
function offsetGeometry(ring: readonly number[], closed = true): { nx: number[]; ny: number[]; cap: number[] } {
  const n = Math.floor(ring.length / 3)
  const nx: number[] = []
  const ny: number[] = []
  const cap: number[] = []
  // Signed area gives a first guess at which side is "out". It is only a guess: CityGML is
  // not consistently wound, and the two ring sources here are wound *oppositely*: a
  // terrain-intersection curve one way, a GroundSurface (whose normal points down) the other.
  // Trusting it alone turns the collar inward, into the building, where every quad is then
  // discarded for being under a footprint and the contact line ends up covered by nothing.
  let area2 = 0
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    area2 += ring[j * 3]! * ring[i * 3 + 1]! - ring[i * 3]! * ring[j * 3 + 1]!
  }
  const sign = area2 >= 0 ? 1 : -1

  // Arc length along the ring, for deciding which segments are "the continuation of this one".
  const arc: number[] = [0]
  for (let i = 1; i <= n; i++) {
    const p = (i - 1) * 3
    const q = (i % n) * 3
    arc.push(arc[i - 1]! + Math.hypot(ring[q]! - ring[p]!, ring[q + 1]! - ring[p + 1]!))
  }
  const perimeter = arc[n]!

  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const next = (i + 1) % n
    const ax = ring[i * 3]! - ring[prev * 3]!
    const ay = ring[i * 3 + 1]! - ring[prev * 3 + 1]!
    const bx = ring[next * 3]! - ring[i * 3]!
    const by = ring[next * 3 + 1]! - ring[i * 3 + 1]!
    const la = Math.hypot(ax, ay) || 1
    const lb = Math.hypot(bx, by) || 1
    // Right-hand normal of each adjacent segment, averaged: the angle bisector.
    let vx = (ay / la + by / lb) * sign
    let vy = (-ax / la - bx / lb) * sign
    const len = Math.hypot(vx, vy)
    if (len < 1e-9) {
      // A spike doubling back on itself has no bisector; one side's normal is as good as any.
      vx = (ay / la) * sign
      vy = (-ax / la) * sign
    } else {
      vx /= len
      vy /= len
    }
    nx.push(vx)
    ny.push(vy)
  }

  // Check the guess against the ring itself: step a little way along each normal and see
  // where you land. Outward is whichever direction mostly leaves the polygon. A closed ring
  // is required for the question to mean anything, so an open polyline keeps the guess.
  if (closed && n >= 3) {
    let inside = 0
    const probe = Math.min(0.25, ringScale(ring, n) / 8)
    for (let i = 0; i < n; i++) {
      if (pointInRings([[...ring]], ring[i * 3]! + nx[i]! * probe, ring[i * 3 + 1]! + ny[i]! * probe)) inside++
    }
    if (inside * 2 > n) {
      for (let i = 0; i < n; i++) { nx[i] = -nx[i]!; ny[i] = -ny[i]! }
    }
  }

  for (let i = 0; i < n; i++) {
    let nearest = Infinity
    for (let k = 0; k < n; k++) {
      if (!closed && k === n - 1) break
      const gap = arcGap(arc, perimeter, i, k, closed)
      if (gap <= LOCAL_FEATURE_WINDOW_M) continue
      const d = pointSegment2d(
        ring[i * 3]!, ring[i * 3 + 1]!,
        ring[k * 3]!, ring[k * 3 + 1]!,
        ring[((k + 1) % n) * 3]!, ring[((k + 1) % n) * 3 + 1]!,
      )
      if (d < nearest) nearest = d
    }
    cap.push(Number.isFinite(nearest) ? nearest * 0.4 : COLLAR_REACH_M + APRON_M)
  }
  return { nx, ny, cap }
}

/** Rough extent of a ring, so a probe step suits a garden shed as well as a factory. */
function ringScale(ring: readonly number[], n: number): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = ring[i * 3]!, y = ring[i * 3 + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return Math.min(maxX - minX, maxY - minY)
}

/** Shortest distance along the ring from vertex `i` to segment `k`, either way round. */
function arcGap(arc: readonly number[], perimeter: number, i: number, k: number, closed: boolean): number {
  const a = Math.abs(arc[i]! - arc[k]!)
  const b = Math.abs(arc[i]! - arc[k + 1]!)
  const near = Math.min(closed ? Math.min(a, perimeter - a) : a, closed ? Math.min(b, perimeter - b) : b)
  return near
}

/** Distance in plan from a point to a segment. */
function pointSegment2d(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax
  const ey = by - ay
  const len2 = ex * ex + ey * ey
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / len2))
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey))
}

/** Push a closed ring outward, for the zone the collar owns. */

const smoothstep = (t: number) => t * t * (3 - 2 * t)

// --- the mesh -------------------------------------------------------------------------

/**
 * Build the warped ground.
 *
 * A regular grid carries the far field; quads whose corners fall inside a building are
 * dropped, so terrain never covers one; and a collar of offset rings carries the surface from
 * the building's contact line out to the field. The collar's innermost ring *is* the contact
 * line (the same numbers, not a resampling), so every point along it lies on the surface, not
 * merely every vertex.
 */
export function buildTerrainMesh(input: TerrainInput): TerrainMesh {
  const span = Math.max(input.bbox.maxX - input.bbox.minX, input.bbox.maxY - input.bbox.minY)
  const cell = input.cellM ?? Math.max(TERRAIN_CELL_M, span / TERRAIN_MAX_CELLS)
  const { bbox, origin, fallbackZ } = input
  const width = bbox.maxX - bbox.minX
  const depth = bbox.maxY - bbox.minY
  if (!(width > 0) || !(depth > 0)) {
    return { positions: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array(), source: 'none', rimVertices: 0 }
  }

  const constraintPoints = input.field ? [] : declusterAverage(input.constraints.flatMap(toPoints))
  const index = bucketIndex(constraintPoints)
  const rims = input.rimRings.filter((r) => r.length >= 9)
  /** The one place heights come from, whatever supplied them. */
  const height = input.field ?? ((x: number, y: number) => sampleHeight(index, x, y, fallbackZ))
  const source: TerrainMesh['source'] = input.field
    ? 'dgm'
    : rims.length && constraintPoints.length ? 'exact' : 'none'

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const uvBox: [number, number, number, number] = [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]
  /**
   * Emit a triangle unless it has no area in plan.
   *
   * The drape is a function of x and y, so a triangle with no plan area covers no pixels, but
   * it does reach the rasteriser, and the fold guard produces them wherever it binds and two
   * offset rings land on the same point. Dropping them here keeps that a local decision.
   */
  const tri = (a: number, b: number, c: number): void => {
    const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!
    const area2 = (positions[b * 3]! - ax) * (positions[c * 3 + 1]! - ay) -
                  (positions[c * 3]! - ax) * (positions[b * 3 + 1]! - ay)
    if (Math.abs(area2) < 1e-9) return
    indices.push(a, b, c)
  }
  const push = (x: number, y: number, z: number): number => {
    positions.push(x - origin[0], y - origin[1], z - origin[2])
    const [u, v] = orthoUv(x, y, uvBox)
    uvs.push(u, v)
    return positions.length / 3 - 1
  }

  // With no contact line anywhere in view the surface is flat, and then a hole under a building
  // shows the void instead of the ground: nothing is warped, so nothing pokes through that a
  // hole would have hidden. Cutting none of them makes this case exactly the plane it replaced.
  const closedHoles = source === 'none' ? [] : input.holes.filter(isClosed)
  const holeIndex = buildRingIndex(closedHoles)
  const inHole = (x: number, y: number) => closedHoles.length > 0 && ringIndexContains(holeIndex, x, y)

  // --- collar, built first because how far it actually reaches decides what the grid keeps ---
  //
  // A narrow alley or a tight courtyard caps the offset well short of COLLAR_REACH_M. Cutting
  // the grid against the nominal reach instead of the real one is what leaves a ring of holes
  // around the building, so the two are derived from the same points.
  let rimVertices = 0
  /** Outermost blended ring of each collar, in plan: the region the collar is responsible for. */
  const covered: number[][] = []

  for (const raw of rims) {
    // Closed rings repeat their first vertex. Left in, it makes a zero-width quad and a pair
    // of degenerate triangles at the seam.
    const ring = dropClosingDuplicate(raw)
    const n = Math.floor(ring.length / 3)
    if (n < 3) continue
    const closed = isClosed(raw)
    const { nx: onx, ny: ony, cap } = offsetGeometry(ring, closed)

    // One ring past the blend, flat on the field. Grid quads that straddle the cut boundary
    // survive, so this apron is the band where the two surfaces overlap, and both are on the
    // field there, which is what makes the overlap invisible rather than a seam.
    const reaches: number[] = []
    for (let k = 0; k <= COLLAR_RINGS; k++) reaches.push(COLLAR_REACH_M * Math.pow(k / COLLAR_RINGS, 1.5))
    reaches.push(COLLAR_REACH_M + APRON_M)

    let previous: number[] = []
    let previousXy: number[] = []
    for (let k = 0; k < reaches.length; k++) {
      const blended = Math.min(k / COLLAR_RINGS, 1)
      const w = smoothstep(blended)
      const current: number[] = []
      const currentXy: number[] = []
      for (let i = 0; i < n; i++) {
        const px = ring[i * 3]!
        const py = ring[i * 3 + 1]!
        const pz = ring[i * 3 + 2]!
        if (k === 0) {
          // The contact line itself, verbatim, the one place this surface is exact.
          current.push(push(px, py, pz))
          currentXy.push(px, py)
          rimVertices++
          continue
        }
        const d = Math.min(reaches[k]!, cap[i]!)
        const qx = px + onx[i]! * d
        const qy = py + ony[i]! * d
        const field = height(qx, qy)
        // A hair above the grid wherever they overlap, so the pair cannot z-fight. Ring 0 is
        // untouched, because w is zero there.
        current.push(push(qx, qy, pz * (1 - w) + field * w + COLLAR_LIFT_M * w))
        currentXy.push(qx, qy)
      }
      if (k > 0) {
        for (let i = 0; i < n; i++) {
          if (!closed && i === n - 1) break
          const j = (i + 1) % n
          // Where a collar runs into another building (a party wall, or a neighbour close by),
          // it would be drawn over that building's own contact line. Its footprint wins.
          const inside =
            inHole(previousXy[i * 2]!, previousXy[i * 2 + 1]!) &&
            inHole(previousXy[j * 2]!, previousXy[j * 2 + 1]!) &&
            inHole(currentXy[j * 2]!, currentXy[j * 2 + 1]!) &&
            inHole(currentXy[i * 2]!, currentXy[i * 2 + 1]!)
          if (inside) continue
          tri(previous[i]!, previous[j]!, current[j]!)
          tri(previous[i]!, current[j]!, current[i]!)
        }
      }
      if (k === COLLAR_RINGS && closed) covered.push([...currentXy])
      previous = current
      previousXy = currentXy
    }
  }

  // --- grid ---
  const nx = Math.max(1, Math.round(width / cell))
  const ny = Math.max(1, Math.round(depth / cell))
  const gridStart: number[] = []
  for (let iy = 0; iy <= ny; iy++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = bbox.minX + (ix / nx) * width
      const y = bbox.minY + (iy / ny) * depth
      gridStart.push(push(x, y, height(x, y)))
    }
  }

  const coveredIndex = buildRingIndex(covered.map(toClosedRing))
  const at = (ix: number, iy: number) => gridStart[iy * (nx + 1) + ix]!
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x0 = bbox.minX + (ix / nx) * width
      const y0 = bbox.minY + (iy / ny) * depth
      const x1 = bbox.minX + ((ix + 1) / nx) * width
      const y1 = bbox.minY + ((iy + 1) / ny) * depth
      const corners: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
      // Under a building, or wholly inside a collar: nothing there is ever seen. Both rules are
      // all-four-corners, so a quad on either boundary survives and overlaps rather than
      // leaving a gap, which is exactly what the collar's apron is there to absorb.
      if (corners.every(([x, y]) => inHole(x, y))) continue
      if (covered.length && corners.every(([x, y]) => ringIndexContains(coveredIndex, x, y))) continue
      const a = at(ix, iy)
      const b = at(ix + 1, iy)
      const c = at(ix + 1, iy + 1)
      const d = at(ix, iy + 1)
      tri(a, b, c)
      tri(a, c, d)
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    source,
    rimVertices,
  }
}

/** xy pairs to a closed flat-xyz ring at z = 0, which is all `pointInRings` reads. */
function toClosedRing(xy: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < xy.length; i += 2) out.push(xy[i]!, xy[i + 1]!, 0)
  out.push(out[0]!, out[1]!, 0)
  return out
}

function dropClosingDuplicate(ring: readonly number[]): number[] {
  const n = ring.length
  if (n >= 6 &&
      Math.abs(ring[0]! - ring[n - 3]!) < 1e-9 &&
      Math.abs(ring[1]! - ring[n - 2]!) < 1e-9) {
    return ring.slice(0, n - 3)
  }
  return [...ring]
}

function toPoints(ring: readonly number[]): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 2 < ring.length; i += 3) out.push([ring[i]!, ring[i + 1]!, ring[i + 2]!])
  return out
}

/**
 * How much of a building the ground has climbed, given the line where they meet.
 *
 * The floor slab is level and the contact line is not, so the area between them (swept along
 * the perimeter) is wall standing in earth. It matters for an energy assessment, where buried
 * wall loses heat quite differently from exposed wall, and `wallArea` counts them alike.
 *
 * Segments that dip below the slab contribute nothing rather than negative area: the ground
 * falling away from a building does not un-bury the other side of it.
 *
 * The rings are a contact line where the source publishes one and a footprint draped over a
 * terrain model where it does not, which is why this takes rings rather than a building: the
 * arithmetic is the same and only the provenance differs.
 */
export function buriedAgainstRim(
  rings: readonly number[][],
  groundZ: number | null,
): { buriedDepth: number | null; buriedWallArea: number | null } {
  if (groundZ === null || !rings.length) return { buriedDepth: null, buriedWallArea: null }
  let maxZ = -Infinity
  let area = 0
  for (const ring of rings) {
    for (let i = 0; i + 5 < ring.length; i += 3) {
      const length = Math.hypot(ring[i + 3]! - ring[i]!, ring[i + 4]! - ring[i + 1]!)
      const rise = (ring[i + 2]! + ring[i + 5]!) / 2 - groundZ
      if (rise > 0) area += length * rise
    }
    for (let i = 2; i < ring.length; i += 3) if (ring[i]! > maxZ) maxZ = ring[i]!
  }
  if (!Number.isFinite(maxZ)) return { buriedDepth: null, buriedWallArea: null }
  return { buriedDepth: Math.max(0, maxZ - groundZ), buriedWallArea: area }
}

/**
 * Drop vertices that lie on the line between their neighbours, and round to millimetres.
 *
 * LoD2 contact lines run along straight walls but carry a vertex wherever any adjacent face
 * changes, so most of them say nothing. `tolM` is deliberately far below what the eye or the
 * data can resolve: the curve is the one place this surface is *exact*, and shaving it to save
 * bytes would trade the property the whole feature exists for.
 */
export function simplifyRing(ring: readonly number[], tolM = SIMPLIFY_TOL_M): number[] {
  const n = Math.floor(ring.length / 3)
  if (n < 3) return [...ring]

  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1

  // Douglas-Peucker, iterative so a long curve cannot blow the stack.
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1
    let worstD = tolM
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(ring, i, a, b)
      if (d > worstD) { worstD = d; worst = i }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }

  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue
    out.push(mm(ring[i * 3]!), mm(ring[i * 3 + 1]!), mm(ring[i * 3 + 2]!))
  }
  return out
}

/** Millimetres, which is finer than any published LoD2 coordinate is meaningful to. */
const mm = (v: number): number => Math.round(v * 1000) / 1000

const SIMPLIFY_TOL_M = 0.02

/** Perpendicular distance in 3D from vertex `i` to the segment from `a` to `b`. */
function pointSegmentDistance(ring: readonly number[], i: number, a: number, b: number): number {
  const px = ring[i * 3]!, py = ring[i * 3 + 1]!, pz = ring[i * 3 + 2]!
  const ax = ring[a * 3]!, ay = ring[a * 3 + 1]!, az = ring[a * 3 + 2]!
  const bx = ring[b * 3]!, by = ring[b * 3 + 1]!, bz = ring[b * 3 + 2]!
  const ex = bx - ax, ey = by - ay, ez = bz - az
  const len2 = ex * ex + ey * ey + ez * ez
  if (len2 === 0) return Math.hypot(px - ax, py - ay, pz - az)
  const t = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / len2))
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey), pz - (az + t * ez))
}
