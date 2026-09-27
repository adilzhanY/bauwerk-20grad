import type pg from 'pg'
import {
  buildingFunctionLabel,
  roofTypeLabel,
  type BuildingDetail,
  type BuildingPartDto,
  type Neighbour,
  type Orthophoto,
  type SearchHit,
} from 'lod2-core'
import { getAdapter } from 'lod2-ingest/adapters'
import { pixelSize, squareAround } from './orthophoto.ts'
import { escapeLike } from './params.ts'

/** Buildings as a Mapbox Vector Tile. Empty tile => zero-length buffer, not an error. */
export async function buildingTile(
  pool: pg.Pool, z: number, x: number, y: number,
): Promise<Buffer> {
  // Below z16 a footprint is a few pixels across, so collapse detail that cannot be
  // seen anyway. Tolerance is two tile-units expressed in mercator metres at this zoom.
  const toleranceM = z < 16 ? (40075016.686 / 2 ** z / 4096) * 2 : 0
  const geomExpr = toleranceM > 0
    ? `ST_SimplifyPreserveTopology(b.ground_3857, ${toleranceM})`
    : 'b.ground_3857'

  const { rows } = await pool.query<{ mvt: Buffer }>(
    `WITH env AS (SELECT ST_TileEnvelope($1,$2,$3) AS geom),
     src AS (
       SELECT b.gid, b.building_gid, b.state, b.roof_type_code, b.function_code,
              b.measured_height, b.ridge_height, b.footprint_area, b.volume,
              array_length(b.flags, 1) IS NOT NULL AS has_flags,
              ST_AsMVTGeom(${geomExpr}, env.geom, 4096, 64, true) AS geom
         FROM building b, env
        WHERE b.has_geometry
          AND b.ground_3857 && env.geom
     )
     -- No feature-id column: ST_AsMVT requires an integer there and our ids are the
     -- AdV Gebäude-ID (text). The client uses MapLibre's promoteId on 'gid' instead.
     SELECT ST_AsMVT(src, 'buildings', 4096, 'geom') AS mvt
       FROM src WHERE geom IS NOT NULL`,
    [z, x, y],
  )
  return rows[0]?.mvt ?? Buffer.alloc(0)
}

/** Coverage of the source-tile grid, so the map can say "not ingested" vs "no buildings". */
export async function coverageTile(
  pool: pg.Pool, z: number, x: number, y: number, pendingKeys: string[],
): Promise<Buffer> {
  const { rows } = await pool.query<{ mvt: Buffer }>(
    `WITH env AS (SELECT ST_TileEnvelope($1,$2,$3) AS geom),
     src AS (
       SELECT ti.state, ti.tile_id,
              CASE WHEN (ti.state || '/' || ti.tile_id) = ANY($4::text[]) THEN 'fetching'
                   ELSE COALESCE(ts.status, 'unfetched') END AS status,
              ts.building_count,
              ST_AsMVTGeom(ST_Transform(ti.bbox, 3857), env.geom, 4096, 8, true) AS geom
         FROM tile_index ti
         LEFT JOIN tile_status ts ON ts.state = ti.state AND ts.tile_id = ti.tile_id, env
        WHERE ST_Transform(ti.bbox, 3857) && env.geom
     )
     SELECT ST_AsMVT(src, 'coverage', 4096, 'geom') AS mvt
       FROM src WHERE geom IS NOT NULL`,
    [z, x, y, pendingKeys],
  )
  return rows[0]?.mvt ?? Buffer.alloc(0)
}

const PART_COLUMNS = `
  b.gid, b.is_part, b.has_geometry, b.measured_height, b.roof_type_code,
  b.footprint_area, b.roof_area_3d, b.roof_area_projected, b.wall_area, b.volume,
  b.ground_z, b.eave_height, b.ridge_height, b.flags, b.geometry_repaired, b.mesh`

/**
 * Full detail for one ALKIS building: every part that carries geometry, plus totals
 * summed across them. Attributes are coalesced across the group because AdV puts them
 * on the parent while the geometry sits on the parts.
 */
export async function buildingDetail(
  pool: pg.Pool, buildingGid: string,
): Promise<BuildingDetail | null> {
  const { rows } = await pool.query(
    `SELECT ${PART_COLUMNS}, b.building_gid, b.state, b.ags, b.function_code,
            to_char(b.creation_date, 'YYYY-MM-DD') AS creation_date, b.source_tile, b.source_ts, b.metrics
       FROM building b
      WHERE b.building_gid = $1
      ORDER BY b.is_part, b.gid`,
    [buildingGid],
  )
  if (!rows.length) return null

  const planes = await pool.query(
    `SELECT gid, idx, area_3d, area_projected, azimuth, tilt
       FROM building_roof_plane WHERE gid = ANY($1::text[]) ORDER BY gid, idx`,
    [rows.map((r) => r.gid)],
  )
  const planesByGid = new Map<string, BuildingPartDto['roofPlanes']>()
  for (const p of planes.rows) {
    const arr = planesByGid.get(p.gid) ?? []
    arr.push({
      idx: p.idx, area3d: p.area_3d, areaProjected: p.area_projected,
      azimuth: p.azimuth, tilt: p.tilt,
    })
    planesByGid.set(p.gid, arr)
  }

  const first = rows[0]!
  const pick = <T>(get: (r: (typeof rows)[number]) => T): T | null =>
    (rows.find((r) => get(r) !== null && get(r) !== undefined)
      ? get(rows.find((r) => get(r) !== null && get(r) !== undefined)!)
      : null) as T | null

  const functionCode = pick((r) => r.function_code)
  const roofTypeCode = pick((r) => r.roof_type_code)
  const withGeom = rows.filter((r) => r.has_geometry)
  const sum = (f: (r: (typeof rows)[number]) => number | null): number =>
    withGeom.reduce((s, r) => s + (f(r) ?? 0), 0)
  const maxOf = (f: (r: (typeof rows)[number]) => number | null): number | null => {
    const vals = withGeom.map(f).filter((v): v is number => v !== null)
    return vals.length ? Math.max(...vals) : null
  }
  const minOf = (f: (r: (typeof rows)[number]) => number | null): number | null => {
    const vals = withGeom.map(f).filter((v): v is number => v !== null)
    return vals.length ? Math.min(...vals) : null
  }

  // Kept separate: a missing adapter and a failed imagery lookup are different problems,
  // and folding them into one catch silently degraded the attribution too.
  let attribution = first.state
  let adapter: ReturnType<typeof getAdapter> | null = null
  try {
    adapter = getAdapter(first.state)
    attribution = adapter.attribution
  } catch {
    // State is indexed but has no adapter compiled in; attribution stays as the code.
  }

  let orthophoto: Orthophoto | null = null
  if (adapter) {
    try {
      const boxes = await buildingBoxes(pool, adapter, buildingGid)
      if (boxes) {
        // Berlin's TrueDOP layers answer no GetFeatureInfo, so the vintage is the product
        // year carried on the service rather than a date asked for per roof.
        orthophoto = orthophotoFor(adapter, boxes, adapter.orthophoto?.acquiredAt ?? null)
      }
    } catch (err) {
      // Imagery is optional, the viewer falls back to a flat roof colour, but a failure
      // here is a real fault and should not vanish.
      console.warn(`orthophoto descriptor for ${buildingGid} failed:`, (err as Error).message)
    }
  }

  /**
   * Burial, computed at ingest from the building's own `lod2TerrainIntersection`.
   *
   * Null where the source published no contact line for that part, which is a fact about
   * the data, not a gap to be filled in here.
   */
  const buriedOf = (r: { gid: string; metrics?: { buriedDepth?: number | null; buriedWallArea?: number | null } | null }) =>
    r.metrics?.buriedDepth != null
      ? { buriedDepth: r.metrics.buriedDepth, buriedWallArea: r.metrics.buriedWallArea ?? null }
      : { buriedDepth: null, buriedWallArea: null }

  return {
    buildingGid,
    state: first.state,
    ags: pick((r) => r.ags),
    functionCode,
    functionLabel: buildingFunctionLabel(functionCode),
    roofTypeCode,
    roofTypeLabel: roofTypeLabel(roofTypeCode),
    // Formatted in SQL: a pg date parses as local midnight, and toISOString would shift it a day.
    creationDate: first.creation_date ?? null,
    sourceTile: first.source_tile,
    sourceTs: first.source_ts ? new Date(first.source_ts).toISOString() : null,
    attribution,
    totals: {
      footprintArea: sum((r) => r.footprint_area),
      roofArea3d: sum((r) => r.roof_area_3d),
      roofAreaProjected: sum((r) => r.roof_area_projected),
      wallArea: sum((r) => r.wall_area),
      volume: sum((r) => r.volume),
      ridgeHeight: maxOf((r) => r.ridge_height),
      eaveHeight: minOf((r) => r.eave_height),
      // Deepest point across the parts, and buried wall summed over them, a building is as
      // buried as its most buried part, but its buried wall is all of it.
      buriedDepth: maxOf((r) => buriedOf(r).buriedDepth),
      buriedWallArea: rows.some((r) => buriedOf(r).buriedWallArea != null)
        ? sum((r) => buriedOf(r).buriedWallArea ?? 0)
        : null,
    },
    attributes: (rows.find((r) => r.metrics?.attributes && Object.keys(r.metrics.attributes).length)
      ?.metrics.attributes ?? {}) as Record<string, string>,
    orthophoto,
    parts: rows.map((r) => ({
      gid: r.gid,
      isPart: r.is_part,
      hasGeometry: r.has_geometry,
      measuredHeight: r.measured_height,
      roofTypeCode: r.roof_type_code,
      roofTypeLabel: roofTypeLabel(r.roof_type_code),
      footprintArea: r.footprint_area,
      roofArea3d: r.roof_area_3d,
      roofAreaProjected: r.roof_area_projected,
      wallArea: r.wall_area,
      volume: r.volume,
      groundZ: r.ground_z,
      eaveHeight: r.eave_height,
      ridgeHeight: r.ridge_height,
      flags: r.flags ?? [],
      geometryRepaired: r.geometry_repaired,
      buriedDepth: buriedOf(r).buriedDepth,
      buriedWallArea: buriedOf(r).buriedWallArea,
      mesh: r.mesh,
      roofPlanes: planesByGid.get(r.gid) ?? [],
    })),
    flags: [...new Set(rows.flatMap((r) => (r.flags ?? []) as string[]))],
  }
}

/**
 * Where to fetch orthophoto imagery for a building, and the bboxes to drape it with.
 *
 * The extent is taken in the state's own CRS (the footprint is stored in 4326 for the map,
 * but the meshes and therefore the UVs live in UTM), so the image and the geometry share
 * one coordinate frame and the viewer needs nothing but these four numbers.
 *
 * Two images rather than one: the roof wants a tight crop at native resolution, while the
 * ground plane only reads as context if it extends well past the building.
 */
const PAD_M = 2
/**
 * Matches NEIGHBOUR_BOX_DEFAULT_M: the context image is what neighbour roofs are draped with, so
 * anything the neighbour query can return must fall inside it, and so must the terrain the
 * neighbours stand in.
 *
 * 400 m is the largest half-box that still keeps Berlin's 20 cm imagery at native resolution
 * against the 4096 px request cap (800 m / 4096 px = 19.5 cm). The selected building's own
 * roof has a separate, tight crop, so this image only ever covers ground and neighbouring
 * roofs.
 */
const CONTEXT_HALF_M = 400
/**
 * Pixel cap for the context image alone, below what native resolution would ask for.
 *
 * The roof crop is the one anybody looks at closely and stays native. This one is the ground
 * plane and the neighbours' roofs, seen from above at a distance, and at 800 m across a pane
 * a few hundred pixels wide, the screen is already better than a metre per pixel.
 *
 * The cost of getting this wrong is not bandwidth, it is a frozen tab. At Berlin's 20 cm a
 * native 800 m crop is 4000 x 4000: 2.8 MB of progressive JPEG that decodes to 16 megapixels
 * and uploads as 61 MB of RGBA, all on the main thread, every time a building is selected.
 * 2048 is a quarter of that and still roughly three times finer than the screen it lands on.
 */
const CONTEXT_MAX_PX = 2048

/**
 * Cap on neighbours returned for one building.
 *
 * Well above what an 800 m box holds in dense inner-city fabric, so it exists to stop a
 * pathological query rather than to shape the normal answer.
 */
const NEIGHBOUR_LIMIT = 6000

interface Extent { minx: number; miny: number; maxx: number; maxy: number }

/** The building's own extent in the state's CRS, and the two boxes derived from it. */
async function buildingBoxes(
  pool: pg.Pool,
  adapter: ReturnType<typeof getAdapter>,
  buildingGid: string,
): Promise<{ roof: [number, number, number, number]; context: [number, number, number, number] } | null> {
  const { rows } = await pool.query<Extent>(
    `SELECT ST_XMin(e) minx, ST_YMin(e) miny, ST_XMax(e) maxx, ST_YMax(e) maxy
       FROM (SELECT ST_Extent(ST_Transform(ground, $2::integer))::geometry AS e
               FROM building WHERE building_gid = $1 AND ground IS NOT NULL) s`,
    [buildingGid, adapter.epsg],
  )
  const e = rows[0]
  if (!e || e.minx === null) return null
  return {
    roof: [e.minx - PAD_M, e.miny - PAD_M, e.maxx + PAD_M, e.maxy + PAD_M],
    context: squareAround((e.minx + e.maxx) / 2, (e.miny + e.maxy) / 2, CONTEXT_HALF_M),
  }
}

function orthophotoFor(
  adapter: ReturnType<typeof getAdapter>,
  boxes: { roof: [number, number, number, number]; context: [number, number, number, number] },
  acquiredAt: string | null,
): Orthophoto | null {
  const service = adapter.orthophoto
  if (!service) return null
  const { roof: roofBbox, context: contextBbox } = boxes

  const describe = (bbox: [number, number, number, number], maxPx: number) => {
    const { width, height } = pixelSize(bbox, service.gsdM, maxPx)
    // maxPx travels with the url, or the route would recompute the size from the service's
    // own cap and serve something other than what widthPx/heightPx here promise.
    const q = new URLSearchParams({
      state: adapter.code, bbox: bbox.join(','), maxPx: String(maxPx),
    })
    return { url: `/orthophoto?${q}`, bbox, widthPx: width, heightPx: height }
  }

  return {
    roof: describe(roofBbox, service.maxPx),
    context: describe(contextBbox, Math.min(service.maxPx, CONTEXT_MAX_PX)),
    epsg: adapter.epsg,
    gsdM: service.gsdM,
    trueOrtho: service.trueOrtho,
    acquiredAt,
    attribution: service.attribution,
    licence: service.licence,
  }
}

/**
 * Buildings whose footprint touches a box of `boxM` metres centred on this building.
 *
 * Selection is by *footprint intersection with a box centred on the building itself*, not
 * by centroid distance from the map view. Both of the things that replaces were wrong in
 * different ways: measuring from the view centre meant the set shifted as the user panned,
 * and comparing centroids excluded a long building abutting the selection while including
 * a small detached one twice as far away.
 */
export async function neighboursInBox(
  pool: pg.Pool,
  buildingGid: string,
  boxM: number,
  epsg: number,
): Promise<Neighbour[]> {
  const half = boxM / 2
  const { rows } = await pool.query(
    // MATERIALIZED on both CTEs, or the planner inlines them and recomputes the target
    // footprint once per candidate row, 300k evaluations for a single lookup.
    `WITH target AS MATERIALIZED (
       SELECT ST_Transform(ST_Centroid(ST_Collect(ground)), $3::integer) AS c,
              ST_Collect(ground) AS footprint
         FROM building WHERE building_gid = $1 AND ground IS NOT NULL
     ),
     box AS MATERIALIZED (
       SELECT ST_Transform(
                ST_MakeEnvelope(ST_X(c) - $2, ST_Y(c) - $2, ST_X(c) + $2, ST_Y(c) + $2,
                                $3::integer), 4326) AS g
         FROM target
     )
     SELECT b.building_gid, b.roof_type_code, b.mesh,
            -- Edge-to-edge distance from the selected building, not centre-to-centre:
            -- the whole point is that a long building abutting it counts as adjacent.
            ST_Distance(b.ground::geography, target.footprint::geography) AS distance
       FROM building b, box, target
      WHERE b.has_geometry AND b.mesh IS NOT NULL
        AND b.building_gid <> $1
        AND b.ground && box.g
        AND ST_Intersects(b.ground, box.g)
      ORDER BY distance
      LIMIT $4`,
    [buildingGid, half, epsg, NEIGHBOUR_LIMIT],
  )
  // Ordered by distance, so a truncation loses the outermost ring, which reads as a ragged
  // hole in the context rather than as a limit. It should not bite; say so if it does.
  if (rows.length === NEIGHBOUR_LIMIT) {
    console.warn(`neighbours for ${buildingGid} hit the ${NEIGHBOUR_LIMIT} cap at ${boxM} m; the outermost buildings are missing`)
  }
  return rows.map((r) => ({
    buildingGid: r.building_gid,
    distance: r.distance,
    mesh: r.mesh,
    roofTypeCode: r.roof_type_code,
  }))
}

/**
 * Direct lookup by AdV Gebäude-ID, which is what users paste from other ALKIS tools.
 *
 * Case-sensitive LIKE, deliberately: AdV ids encode case, and the mixed-case tail is not
 * decoration, DEBE01YYK00002Gu, DEBE01YYK00002gu and DEBE01YYK00002GU would be three
 * different buildings. A case-insensitive match here silently shows the wrong one.
 *
 * This is also the only way to find a building by name, since Berlin publishes no addresses.
 */
export async function findByGid(pool: pg.Pool, gid: string): Promise<SearchHit[]> {
  const { rows } = await pool.query(
    `SELECT b.building_gid, b.building_gid AS label,
            ST_X(ST_Centroid(ST_Collect(b.centroid))) lon,
            ST_Y(ST_Centroid(ST_Collect(b.centroid))) lat
       FROM building b
      WHERE b.building_gid LIKE $1 ESCAPE '\\' AND b.centroid IS NOT NULL
      GROUP BY b.building_gid LIMIT 10`,
    // The prefix is bound as one finished pattern so the text_pattern_ops index applies.
    [`${escapeLike(gid)}%`],
  )
  return rows.map((r) => ({
    buildingGid: r.building_gid, label: r.label, lon: r.lon, lat: r.lat,
  }))
}

/**
 * The building at a point, for address search: the one whose ground footprint contains the
 * point or lies closest to it within about 30 m (a geocoded house number sits on the
 * pavement as often as on the roof). The bounding-box test uses the ground GIST index.
 * Null when no loaded building is near.
 */
export async function buildingAt(pool: pg.Pool, lon: number, lat: number): Promise<string | null> {
  const { rows } = await pool.query(
    `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS pt)
     SELECT b.building_gid
       FROM building b, p
      WHERE b.ground IS NOT NULL
        AND b.ground && ST_Expand(p.pt, 0.0005)
      ORDER BY ST_Distance(b.ground::geography, p.pt::geography)
      LIMIT 1`,
    [lon, lat],
  )
  return rows[0]?.building_gid ?? null
}
