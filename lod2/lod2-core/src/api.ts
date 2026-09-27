/**
 * Wire contract between lod2-api and lod2-viewer.
 *
 * Lives in core so both sides import the same schemas: the server validates what it
 * emits, the client validates what it receives, and a drift between them is a test
 * failure rather than a runtime surprise in the browser.
 */
import { z } from 'zod'

export const SurfaceKindSchema = z.enum(['wall', 'roof', 'ground', 'closure', 'unknown'])

export const MeshSchema = z.object({
  origin: z.tuple([z.number(), z.number(), z.number()]),
  /** Terrain-intersection rings, rebased on the same origin. Absent where unpublished. */
  terrain: z.array(z.array(z.number())).optional(),
  surfaces: z.array(z.object({
    kind: SurfaceKindSchema,
    rings: z.array(z.array(z.number())),
  })),
})

export const RoofPlaneSchema = z.object({
  idx: z.number().int(),
  area3d: z.number(),
  areaProjected: z.number(),
  azimuth: z.number().nullable(),
  tilt: z.number(),
})

/** One geometry-bearing feature: a standalone Building or a BuildingPart. */
export const BuildingPartSchema = z.object({
  gid: z.string(),
  isPart: z.boolean(),
  hasGeometry: z.boolean(),
  measuredHeight: z.number().nullable(),
  roofTypeCode: z.string().nullable(),
  roofTypeLabel: z.string().nullable(),
  footprintArea: z.number().nullable(),
  roofArea3d: z.number().nullable(),
  roofAreaProjected: z.number().nullable(),
  wallArea: z.number().nullable(),
  volume: z.number().nullable(),
  groundZ: z.number().nullable(),
  eaveHeight: z.number().nullable(),
  ridgeHeight: z.number().nullable(),
  /** How far the terrain climbs the walls, and how much wall stands below it. */
  buriedDepth: z.number().nullable(),
  buriedWallArea: z.number().nullable(),
  flags: z.array(z.string()),
  geometryRepaired: z.boolean(),
  mesh: MeshSchema.nullable(),
  roofPlanes: z.array(RoofPlaneSchema),
})

/**
 * A georeferenced image the viewer can drape by (x, y).
 *
 * `bbox` is [minX, minY, maxX, maxY] in `epsg`, and is the whole UV contract: the viewer
 * needs no camera model, only these four numbers and the image behind `url`.
 */
export const OrthoImageSchema = z.object({
  url: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  widthPx: z.number().int(),
  heightPx: z.number().int(),
})

export const OrthophotoSchema = z.object({
  /** Tight on the building, at native resolution, for the roof texture. */
  roof: OrthoImageSchema,
  /** Wider and coarser, for the ground plane the building sits on. */
  context: OrthoImageSchema,
  epsg: z.number().int(),
  gsdM: z.number(),
  /** False means roofs lean outward from nadir; the UI should say so. */
  trueOrtho: z.boolean(),
  /**
   * The day the imagery was flown, ISO, or null where the service will not say.
   *
   * Nullish rather than required: a server older than this field should cost the date, not
   * the building.
   */
  acquiredAt: z.string().nullish().default(null),
  attribution: z.string(),
  licence: z.string(),
})

/**
 * A whole ALKIS building: its attributes, plus every part that carries geometry.
 * Totals are summed across parts, which is why they are computed here rather than
 * read off any single row.
 */
export const BuildingDetailSchema = z.object({
  buildingGid: z.string(),
  state: z.string(),
  ags: z.string().nullable(),
  functionCode: z.string().nullable(),
  functionLabel: z.string().nullable(),
  roofTypeCode: z.string().nullable(),
  roofTypeLabel: z.string().nullable(),
  creationDate: z.string().nullable(),
  sourceTile: z.string().nullable(),
  sourceTs: z.string().nullable(),
  attribution: z.string(),
  totals: z.object({
    footprintArea: z.number(),
    roofArea3d: z.number(),
    roofAreaProjected: z.number(),
    wallArea: z.number(),
    volume: z.number(),
    ridgeHeight: z.number().nullable(),
    eaveHeight: z.number().nullable(),
    buriedDepth: z.number().nullable(),
    buriedWallArea: z.number().nullable(),
  }),
  attributes: z.record(z.string(), z.string()),
  parts: z.array(BuildingPartSchema),
  flags: z.array(z.string()),
  /** Null when the building's state has no DOP service wired up. */
  orthophoto: OrthophotoSchema.nullable(),
})

export const NeighbourSchema = z.object({
  buildingGid: z.string(),
  distance: z.number(),
  mesh: MeshSchema.nullable(),
  roofTypeCode: z.string().nullable(),
})

export const SearchHitSchema = z.object({
  buildingGid: z.string(),
  /** What to show in the result list. The Gebäude-ID itself, Berlin ships no addresses. */
  label: z.string(),
  lon: z.number(),
  lat: z.number(),
})

/**
 * The list answers, built here with this package's own zod: a schema made by one zod copy
 * and wrapped by another fails to type-check when the app and this package each have their own.
 */
export const NeighboursSchema = z.array(NeighbourSchema)
export const SearchHitsSchema = z.array(SearchHitSchema)

export const CoverageStatsSchema = z.object({
  states: z.array(z.object({
    state: z.string(),
    name: z.string(),
    attribution: z.string(),
    indexedTiles: z.number(),
    readyTiles: z.number(),
    emptyTiles: z.number(),
    failedTiles: z.number(),
    buildings: z.number(),
  })),
  /** Below this zoom the API will not fetch source tiles on demand. */
  onDemandMinZoom: z.number(),
})

/**
 * What lod2-vision answers when asked where a wall is in a photo.
 *
 * Corners are in the photo's own pixel coordinates, top-left first and clockwise, the
 * same order the editor's dots use. `paintedPhoto` is the photo with cars and the like
 * painted flat, as a data URL, so the editor can rectify it instead of the original.
 */
export const VisionCornersSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  corners: z.tuple([
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
    z.tuple([z.number(), z.number()]),
  ]),
  /** Fraction of the wall's base hidden by parked things. Above 0.8 the bottom dots need a look. */
  baseHidden: z.number().min(0).max(1),
  bottomFromVanishingPoint: z.boolean(),
  facadeScore: z.number(),
  facadePrompt: z.string(),
  seconds: z.number(),
  paintedPhoto: z.string(),
})

/** One window or door lod2-vision found on the rectified wall, in wall metres. */
export const VisionOpeningSchema = z.object({
  kind: z.enum(['window', 'door']),
  score: z.number().min(0).max(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})

export const VisionOpeningsSchema = z.object({
  openings: z.array(VisionOpeningSchema),
})

export type Mesh = z.infer<typeof MeshSchema>
export type OrthoImage = z.infer<typeof OrthoImageSchema>
export type Orthophoto = z.infer<typeof OrthophotoSchema>
export type BuildingDetail = z.infer<typeof BuildingDetailSchema>
export type BuildingPartDto = z.infer<typeof BuildingPartSchema>
export type RoofPlaneDto = z.infer<typeof RoofPlaneSchema>
export type Neighbour = z.infer<typeof NeighbourSchema>
export type SearchHit = z.infer<typeof SearchHitSchema>
export type CoverageStats = z.infer<typeof CoverageStatsSchema>
export type VisionCorners = z.infer<typeof VisionCornersSchema>
export type VisionOpening = z.infer<typeof VisionOpeningSchema>
export type VisionOpenings = z.infer<typeof VisionOpeningsSchema>
