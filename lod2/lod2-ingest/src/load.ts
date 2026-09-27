import type pg from 'pg'
import {
  PIPELINE_VERSION,
  buildMesh,
  computeMetrics,
  footprintWkt,
  streamBuildings,
  type RawAddress,
  type RawBuilding,
  type StateAdapter,
  type TileRef,
} from 'lod2-core'
import { fetchTileText } from './fetch-tile.ts'
import { tileLockKey } from './db.ts'

const BATCH_ROWS = 400

interface BuildingRow {
  gid: string
  building_gid: string
  state: string
  is_part: boolean
  has_geometry: boolean
  ags: string | null
  function_code: string | null
  roof_type_code: string | null
  measured_height: number | null
  storeys_above_ground: number | null
  creation_date: string | null
  footprint_area: number
  roof_area_3d: number
  roof_area_projected: number
  wall_area: number
  volume: number
  ground_z: number | null
  eave_height: number | null
  ridge_height: number | null
  metrics: unknown
  mesh: unknown
  flags: string[]
  wkt: string | null
  epsg: number
  source_tile: string
  source_ts: string | null
  pipeline_version: number
  address: RawAddress | null
  roof_planes: Array<{ idx: number; area_3d: number; area_projected: number; azimuth: number | null; tilt: number }>
}

const INSERT_BUILDINGS = `
INSERT INTO building (
  gid, building_gid, state, is_part, has_geometry, ags,
  function_code, roof_type_code, measured_height, storeys_above_ground, creation_date,
  footprint_area, roof_area_3d, roof_area_projected, wall_area, volume,
  ground_z, eave_height, ridge_height,
  metrics, mesh, flags, ground, ground_3857, centroid, source_tile, source_ts,
  geometry_repaired, pipeline_version, ingested_at
)
SELECT
  r.gid, r.building_gid, r.state, r.is_part, r.has_geometry, r.ags,
  r.function_code, r.roof_type_code, r.measured_height, r.storeys_above_ground,
  nullif(r.creation_date, '')::date,
  r.footprint_area, r.roof_area_3d, r.roof_area_projected, r.wall_area, r.volume,
  r.ground_z, r.eave_height, r.ridge_height,
  r.metrics, r.mesh,
  ARRAY(SELECT jsonb_array_elements_text(r.flags)),
  g.g4326, ST_Transform(g.g4326, 3857), ST_PointOnSurface(g.g4326),
  r.source_tile, nullif(r.source_ts, '')::timestamptz, g.repaired, r.pipeline_version, now()
FROM jsonb_to_recordset($1::jsonb) AS r(
  gid text, building_gid text, state text, is_part boolean, has_geometry boolean, ags text,
  function_code text, roof_type_code text, measured_height real, storeys_above_ground smallint,
  creation_date text,
  footprint_area real, roof_area_3d real, roof_area_projected real, wall_area real, volume real,
  ground_z real, eave_height real, ridge_height real,
  metrics jsonb, mesh jsonb, flags jsonb, wkt text, epsg integer,
  source_tile text, source_ts text, pipeline_version integer
)
CROSS JOIN LATERAL (
  SELECT ST_GeomFromText(r.wkt, r.epsg) AS raw
) AS src
-- Repair in the source CRS, where the validity test also runs, and only then reproject.
-- Testing one geometry and repairing another lets the flag disagree with what was done.
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN src.raw IS NULL THEN NULL
         ELSE nullif(
           ST_Multi(ST_CollectionExtract(ST_Transform(ST_MakeValid(src.raw), 4326), 3)),
           'MULTIPOLYGON EMPTY'::geometry)
    END AS g4326,
    COALESCE(src.raw IS NOT NULL AND NOT ST_IsValid(src.raw), false) AS repaired
) AS g
ON CONFLICT (gid) DO UPDATE SET
  building_gid = EXCLUDED.building_gid, state = EXCLUDED.state, is_part = EXCLUDED.is_part,
  has_geometry = EXCLUDED.has_geometry, ags = EXCLUDED.ags,
  function_code = EXCLUDED.function_code, roof_type_code = EXCLUDED.roof_type_code,
  measured_height = EXCLUDED.measured_height, storeys_above_ground = EXCLUDED.storeys_above_ground,
  creation_date = EXCLUDED.creation_date,
  footprint_area = EXCLUDED.footprint_area, roof_area_3d = EXCLUDED.roof_area_3d,
  roof_area_projected = EXCLUDED.roof_area_projected, wall_area = EXCLUDED.wall_area,
  volume = EXCLUDED.volume, ground_z = EXCLUDED.ground_z,
  eave_height = EXCLUDED.eave_height, ridge_height = EXCLUDED.ridge_height,
  metrics = EXCLUDED.metrics, mesh = EXCLUDED.mesh, flags = EXCLUDED.flags,
  ground = EXCLUDED.ground, ground_3857 = EXCLUDED.ground_3857, centroid = EXCLUDED.centroid,
  source_tile = EXCLUDED.source_tile, source_ts = EXCLUDED.source_ts,
  geometry_repaired = EXCLUDED.geometry_repaired,
  pipeline_version = EXCLUDED.pipeline_version, ingested_at = now()
`

/**
 * A re-ingested building can have fewer roof planes than before, so its old rows go first.
 * Upserting by (gid, idx) alone would leave the extra planes behind.
 */
const DELETE_ROOF_PLANES = `DELETE FROM building_roof_plane WHERE gid = ANY($1::text[])`

const INSERT_ROOF_PLANES = `
INSERT INTO building_roof_plane (gid, idx, area_3d, area_projected, azimuth, tilt)
SELECT r.gid, r.idx, r.area_3d, r.area_projected, r.azimuth, r.tilt
FROM jsonb_to_recordset($1::jsonb) AS r(
  gid text, idx integer, area_3d real, area_projected real, azimuth real, tilt real
)
ON CONFLICT (gid, idx) DO UPDATE SET
  area_3d = EXCLUDED.area_3d, area_projected = EXCLUDED.area_projected,
  azimuth = EXCLUDED.azimuth, tilt = EXCLUDED.tilt
`

/**
 * Turn one parsed feature into a database row, inheriting whatever the parent carries.
 *
 * Inheritance is necessary because AdV puts the function code and address on the parent
 * `bldg:Building` while the geometry lives on its `bldg:BuildingPart` children. The
 * parts themselves report `function = null`.
 */
function toRow(
  b: RawBuilding,
  parent: RawBuilding | null,
  adapter: StateAdapter,
  tile: TileRef,
): BuildingRow {
  const metrics = computeMetrics(b)
  const hasGeometry = b.surfaces.length > 0
  const ags = b.attributes.Gemeindeschluessel ?? parent?.attributes.Gemeindeschluessel ?? null

  return {
    gid: b.gid,
    // `||` rather than `??`: a parent without a gml:id hands its parts an empty parentGid.
    building_gid: b.parentGid || b.gid,
    state: adapter.code,
    is_part: b.isPart,
    has_geometry: hasGeometry,
    ags,
    function_code: b.functionCode ?? parent?.functionCode ?? null,
    roof_type_code: b.roofTypeCode ?? parent?.roofTypeCode ?? null,
    measured_height: b.measuredHeight,
    storeys_above_ground: b.storeysAboveGround ?? parent?.storeysAboveGround ?? null,
    creation_date: b.creationDate ?? parent?.creationDate ?? null,
    footprint_area: metrics.footprintArea,
    roof_area_3d: metrics.roofArea3d,
    roof_area_projected: metrics.roofAreaProjected,
    wall_area: metrics.wallArea,
    volume: metrics.volume,
    ground_z: metrics.groundZ,
    eave_height: metrics.eaveHeight,
    ridge_height: metrics.ridgeHeight,
    metrics: {
      surfaceCounts: metrics.surfaceCounts,
      minZ: metrics.minZ,
      maxZ: metrics.maxZ,
      roofPlaneCount: metrics.roofPlanes.length,
      // How far the ground has climbed the walls, and how much wall stands in it. Kept in
      // the jsonb rather than as columns: nothing queries them, the panel just reads them.
      buriedDepth: metrics.buriedDepth,
      buriedWallArea: metrics.buriedWallArea,
      attributes: b.attributes,
      address: b.address ?? parent?.address ?? null,
    },
    mesh: hasGeometry ? buildMesh(b) : null,
    flags: metrics.flags,
    wkt: hasGeometry ? footprintWkt(b) : null,
    epsg: adapter.epsg,
    source_tile: tile.id,
    source_ts: tile.sourceTs,
    pipeline_version: PIPELINE_VERSION,
    address: b.address ?? parent?.address ?? null,
    roof_planes: metrics.roofPlanes.map((p) => ({
      idx: p.idx,
      area_3d: p.area3d,
      area_projected: p.areaProjected,
      azimuth: p.azimuth,
      tilt: p.tilt,
    })),
  }
}

async function flush(client: pg.PoolClient, rows: BuildingRow[]): Promise<void> {
  if (!rows.length) return
  const planes = rows.flatMap((r) => r.roof_planes.map((p) => ({ gid: r.gid, ...p })))
  // `address` is dropped here rather than stored in its own table: Berlin's CityGML carries
  // none, so there is nothing to file. It stays on the row inside `metrics` jsonb, which is
  // where a state that does ship addresses would be picked up from.
  const payload = rows.map(({ roof_planes: _ignored, address: _addr, ...rest }) => rest)
  await client.query(INSERT_BUILDINGS, [JSON.stringify(payload)])
  await client.query(DELETE_ROOF_PLANES, [rows.map((r) => r.gid)])
  if (planes.length) await client.query(INSERT_ROOF_PLANES, [JSON.stringify(planes)])
}

export interface LoadTileOptions {
  cachePath?: string
  signal?: AbortSignal
  /** Skip the fetch when this tile is already ingested and unchanged upstream. */
  skipUnchanged?: boolean
}

export interface LoadTileResult {
  tileId: string
  status: 'ready' | 'empty' | 'skipped' | 'failed'
  buildings: number
  parts: number
  ms: number
  error?: string
  /** Features dropped because the source gave them no gml:id to store them under. */
  skippedWithoutId?: number
}

/**
 * The size recorded for a tile. Zero means the source published no size, which is stored as
 * NULL, so the unchanged check compares against the same value that was written.
 */
function storedSize(tile: TileRef): number | null {
  return tile.sizeBytes > 0 ? tile.sizeBytes : null
}

function failedResult(tile: TileRef, started: number, err: unknown): LoadTileResult {
  return {
    tileId: tile.id, status: 'failed', buildings: 0, parts: 0,
    ms: Date.now() - started, error: (err as Error).message,
  }
}

/**
 * Fetch, parse and load one source tile.
 *
 * Holds a Postgres advisory lock for the duration so the CLI and the API's on-demand
 * fetcher can run concurrently without ever downloading the same tile twice.
 */
export async function loadTile(
  pool: pg.Pool,
  adapter: StateAdapter,
  tile: TileRef,
  opts: LoadTileOptions = {},
): Promise<LoadTileResult> {
  const started = Date.now()
  // Anything that escapes here is a lost connection (Postgres restarted, pool exhausted):
  // it costs this one tile, while the other workers carry on.
  try {
    return await loadTileWithClient(pool, adapter, tile, opts, started)
  } catch (err) {
    return failedResult(tile, started, err)
  }
}

async function loadTileWithClient(
  pool: pg.Pool,
  adapter: StateAdapter,
  tile: TileRef,
  opts: LoadTileOptions,
  started: number,
): Promise<LoadTileResult> {
  const client = await pool.connect()
  // A checked-out client emits 'error' directly rather than through the pool, and an
  // unhandled 'error' event takes the whole process down. Measured: the API exited with
  // "Connection terminated unexpectedly" when Postgres was restarted mid-decode by the
  // out-of-memory killer. The lock is held across a download and a decode, so the window is
  // tens of seconds wide. A dropped connection has to cost this one request, not the server.
  //
  // Removed again on the way out. A pooled client outlives the checkout, so leaving the
  // listener attached accumulates one per tile on the same object, which Node reports as a
  // memory leak after ten, and which is one on the eleventh.
  const onClientError = (err: Error) => {
    console.warn(`database connection lost while holding the tile lock: ${err.message}`)
  }
  client.on('error', onClientError)
  const lockKey = tileLockKey(adapter.code, tile.id)

  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockKey.toString()],
    )
    if (!lock.rows[0]?.locked) {
      return { tileId: tile.id, status: 'skipped', buildings: 0, parts: 0, ms: 0 }
    }

    try {
      // Tiles below the empty threshold carry no buildings; the index alone tells us
      // that, so they never cost a request.
      if (tile.sizeBytes > 0 && tile.sizeBytes <= adapter.emptyTileMaxBytes) {
        await markStatus(client, adapter.code, tile, 'empty', { buildingCount: 0 })
        return { tileId: tile.id, status: 'empty', buildings: 0, parts: 0, ms: Date.now() - started }
      }

      if (opts.skipUnchanged) {
        const { rows } = await client.query<{ unchanged: boolean }>(
          `SELECT (status IN ('ready','empty')
                   AND ingested_size IS NOT DISTINCT FROM $3::bigint
                   AND (ingested_sha256 IS NOT DISTINCT FROM $4 OR $4 IS NULL)) AS unchanged
             FROM tile_status WHERE state = $1 AND tile_id = $2`,
          [adapter.code, tile.id, storedSize(tile), tile.sha256],
        )
        if (rows[0]?.unchanged) {
          return { tileId: tile.id, status: 'skipped', buildings: 0, parts: 0, ms: Date.now() - started }
        }
      }

      await markStatus(client, adapter.code, tile, 'fetching', {})

      const text = await fetchTileText(tile.url, {
        cachePath: opts.cachePath,
        // Validating a cached file by exact byte count only works where the index gives
        // exact bytes. Berlin's ATOM feed gives no size at all, so the check would fail
        // every time and re-download what is already on disk.
        expectedBytes: adapter.sizesAreApproximate ? undefined : tile.sizeBytes || undefined,
        signal: opts.signal,
        archiveMember: adapter.archiveMember,
      })

      const gen = streamBuildings(text, { sourceTile: tile.id })
      const batch: BuildingRow[] = []
      // Parts stream out before their parent closes, so hold them until the parent
      // arrives and can hand down its attributes.
      const pendingParts = new Map<string, RawBuilding[]>()
      let buildings = 0
      let parts = 0
      let skippedWithoutId = 0

      await client.query('BEGIN')
      let next = await gen.next()
      while (!next.done) {
        const b = next.value
        if (!b.gid) {
          // No gml:id means no primary key. Storing it would fail the whole batch upsert,
          // so drop just this feature and report it.
          skippedWithoutId++
        } else if (b.isPart && b.parentGid) {
          const arr = pendingParts.get(b.parentGid) ?? []
          arr.push(b)
          pendingParts.set(b.parentGid, arr)
          parts++
        } else {
          buildings++
          batch.push(toRow(b, null, adapter, tile))
          const own = pendingParts.get(b.gid)
          if (own) {
            pendingParts.delete(b.gid)
            for (const p of own) batch.push(toRow(p, b, adapter, tile))
          }
          if (batch.length >= BATCH_ROWS) await flush(client, batch.splice(0, batch.length))
        }
        next = await gen.next()
      }
      // Orphan parts (a parent we never saw) still get stored, just without inheritance.
      for (const orphans of pendingParts.values()) {
        for (const p of orphans) batch.push(toRow(p, null, adapter, tile))
      }
      await flush(client, batch)
      if (skippedWithoutId > 0) {
        console.warn(`${tile.id}: skipped ${skippedWithoutId} features without a gml:id`)
      }

      const total = buildings + parts
      await markStatus(client, adapter.code, tile, total > 0 ? 'ready' : 'empty', {
        buildingCount: total,
      })
      await client.query('COMMIT')

      return {
        tileId: tile.id,
        status: total > 0 ? 'ready' : 'empty',
        buildings,
        parts,
        ms: Date.now() - started,
        skippedWithoutId,
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      const message = (err as Error).message
      await markStatus(client, adapter.code, tile, 'failed', { error: message }).catch(() => {})
      return failedResult(tile, started, err)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey.toString()]).catch(() => {})
    }
  } finally {
    client.off('error', onClientError)
    client.release()
  }
}

async function markStatus(
  client: pg.PoolClient,
  state: string,
  tile: TileRef,
  status: string,
  extra: { buildingCount?: number; error?: string },
): Promise<void> {
  await client.query(
    `INSERT INTO tile_status (
       state, tile_id, status, requested_at, fetched_at, building_count, bytes,
       attempts, error, ingested_sha256, ingested_size)
     VALUES ($1, $2, $3, now(),
             CASE WHEN $3 IN ('ready','empty') THEN now() END,
             $4::integer, $5::bigint,
             CASE WHEN $3 = 'fetching' THEN 1 ELSE 0 END, $6::text,
             CASE WHEN $3 IN ('ready','empty') THEN $7::text END,
             CASE WHEN $3 IN ('ready','empty') THEN $8::bigint END)
     ON CONFLICT (state, tile_id) DO UPDATE SET
       status = EXCLUDED.status,
       requested_at = EXCLUDED.requested_at,
       fetched_at = COALESCE(EXCLUDED.fetched_at, tile_status.fetched_at),
       building_count = COALESCE(EXCLUDED.building_count, tile_status.building_count),
       bytes = COALESCE(EXCLUDED.bytes, tile_status.bytes),
       -- Counts downloads, not status writes: only the move to 'fetching' is an attempt.
       attempts = tile_status.attempts + CASE WHEN EXCLUDED.status = 'fetching' THEN 1 ELSE 0 END,
       error = EXCLUDED.error,
       ingested_sha256 = COALESCE(EXCLUDED.ingested_sha256, tile_status.ingested_sha256),
       ingested_size = COALESCE(EXCLUDED.ingested_size, tile_status.ingested_size)`,
    [
      state, tile.id, status,
      extra.buildingCount ?? null, storedSize(tile), extra.error ?? null,
      tile.sha256, storedSize(tile),
    ],
  )
}
