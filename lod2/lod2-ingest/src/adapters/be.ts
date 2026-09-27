/**
 * Berlin — gdi.berlin.de
 *
 * Discovery is an INSPIRE download service: a catalogue feed that points at `0.atom`, where
 * every tile sits as a `<link rel="section">` inside a single `<entry>` (~925 of them).
 *
 * Two things follow from the source and shape everything here:
 *
 * - **The feed carries no sizes.** No `<size>`, no per-file date, only one `<updated>` for the
 *   whole feed. Fetching sizes with HEAD does not scale against this server: twenty requests
 *   succeed whether sequential or parallel, but of all ~925 only 224 came back — it limits over
 *   time rather than over concurrency. So tiles are advertised with `sizeBytes: 0`, which the
 *   loader already treats as "unknown" rather than as "empty" (`load.ts`, which guards the
 *   empty-tile skip with `sizeBytes > 0`).
 * - **The archive member is `.xml`, not `.gml`**, and the CityGML inside is version 1.0 rather
 *   than 2.0. The parser classifies by namespace URI rather than by prefix or version, so it
 *   reads Berlin unchanged — verified by running it, not by reading the schema.
 *
 * Berlin publishes `lod2TerrainIntersection` on 2,275 of 2,279 buildings in a central tile, so
 * the ground surface is warped from the models themselves rather than from a terrain model.
 *
 * What it does not publish is addresses: not one of those 2,279 buildings carries one. Berlin
 * buildings are therefore findable by Gebäude-ID and by clicking the map, not by street. The
 * Hauskoordinaten are a separate 10 MB download whose ids are address objects rather than
 * buildings, so wiring them up would mean a spatial join — not done here.
 */
import type { OrthophotoService, StateAdapter, TileRef } from 'lod2-core'

/** The download feed itself. The catalogue feed one level up only points here. */
const ATOM = 'https://gdi.berlin.de/data/a_lod2/atom/0.atom'
const TILE_SIZE_M = 1000

/** `LoD2_389_5819.zip` -> easting 389 km, northing 5819 km, EPSG:25833. */
const LINK_RE = /href="([^"]*\/(LoD2_(\d{3})_(\d{4})\.zip))"/g

/** Berlin in EPSG:25833, with a margin. A decode error lands outside this. */
const EXTENT = { minX: 360_000, minY: 5_790_000, maxX: 425_000, maxY: 5_845_000 }

/**
 * Berlin's own TrueDOP, flown in 2026, at 20 cm ground sample distance.
 *
 * The layer is not queryable, so there is no GetFeatureInfo to ask for a flight date. The
 * vintage is in the product name instead, which is coarser than a date but true — and better
 * than the "not stated" the panel would otherwise show.
 */
const beOrthophoto: OrthophotoService = {
  wmsUrl: 'https://gdi.berlin.de/services/wms/truedop_2026',
  layer: 'truedop_2026',
  version: '1.3.0',
  gsdM: 0.2,
  // 8000 x 8000 verified against the live service; it declares no MaxWidth of its own.
  maxPx: 8000,
  trueOrtho: true,
  acquiredAt: '2026',
  attribution: 'Geoportal Berlin (TrueDOP20RGBI 2026)',
  licence: 'dl-de/zero-2-0',
}

export const be: StateAdapter = {
  code: 'BE',
  name: 'Berlin',
  epsg: 25833,
  attribution: 'Geoportal Berlin, dl-de/zero-2-0',
  tileSizeM: TILE_SIZE_M,
  /**
   * Never reached today, because the feed gives no sizes and every tile is advertised as 0.
   * Kept at a plausible threshold so the skip starts working by itself if Berlin ever adds
   * them: the smallest tiles measured 2,466 bytes and eleven sit under 20 kB.
   */
  emptyTileMaxBytes: 3000,
  archiveMember: /_BE\.xml$/i,
  sizesAreApproximate: true,
  orthophoto: beOrthophoto,

  async listTiles(): Promise<TileRef[]> {
    const res = await fetch(ATOM)
    if (!res.ok) throw new Error(`Berlin ATOM feed ${ATOM} returned ${res.status}`)
    const xml = await res.text()

    // One date for the whole feed — the source offers nothing per tile, and inventing one
    // would make change detection look sharper than it is.
    const updated = /<updated>([^<]+)<\/updated>/.exec(xml)?.[1]?.trim() ?? null

    const tiles: TileRef[] = []
    const seen = new Set<string>()
    for (const m of xml.matchAll(LINK_RE)) {
      const [url, name, ex, ny] = [m[1]!, m[2]!, m[3]!, m[4]!]
      if (seen.has(name)) continue
      seen.add(name)

      const minX = Number(ex) * 1000
      const minY = Number(ny) * 1000
      // The filename carries no UTM zone, so this extent is the only guard against a
      // misread: a Berlin tile placed in zone 32 would sit 400 km west, and ST_Transform
      // would carry that out without complaint.
      if (minX < EXTENT.minX || minY < EXTENT.minY || minX > EXTENT.maxX || minY > EXTENT.maxY) {
        throw new Error(`Berlin tile ${name} decodes to ${minX}, ${minY}, outside the state`)
      }

      tiles.push({
        id: `${ex}_${ny}`,
        url,
        // Unknown, not empty. See the note at the top of this file.
        sizeBytes: 0,
        sha256: null,
        bbox: { minX, minY, maxX: minX + TILE_SIZE_M, maxY: minY + TILE_SIZE_M },
        sourceTs: updated,
      })
    }
    if (!tiles.length) throw new Error(`Berlin ATOM feed ${ATOM} parsed but yielded no tiles`)
    return tiles
  },
}
