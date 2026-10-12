/**
 * Domain types for the German LoD2 pipeline.
 *
 * Coordinates are always flat arrays of [x, y, z, x, y, z, ...] in the source CRS
 * (EPSG:25832 / 25833, metres; z is DHHN2016 NHN, orthometric). Rings are stored
 * closed, i.e. the last vertex repeats the first, exactly as CityGML delivers them.
 */

export type SurfaceKind = 'wall' | 'roof' | 'ground' | 'closure' | 'unknown'

/** Codes from the AdV CityGML profile, kept as strings because they are codelist keys. */
export interface Polygon {
  /** Flat xyz, closed. */
  exterior: number[]
  /** Inner rings (courtyards, light wells). Usually empty in LoD2. */
  interiors: number[][]
}

export interface Surface {
  id: string | null
  kind: SurfaceKind
  polygons: Polygon[]
}

export interface RawAddress {
  street: string | null
  houseNumber: string | null
  postcode: string | null
  city: string | null
  country: string | null
}

/**
 * One `bldg:Building` or `bldg:BuildingPart` as parsed from the source GML.
 *
 * BuildingParts are emitted as their own records with `parentGid` set; the loader
 * aggregates them. Dropping parts silently loses geometry for a meaningful fraction
 * of German buildings, so they are first-class here rather than merged at parse time.
 */
export interface RawBuilding {
  /** `gml:id`: the AdV/ALKIS Gebäude-ID, e.g. "DEBE01YYK00002Gu". */
  gid: string
  parentGid: string | null
  isPart: boolean
  creationDate: string | null
  /** `bldg:function`: ALKIS Gebäudefunktion, e.g. "31001_2460". */
  functionCode: string | null
  /** `bldg:roofType`: AdV Dachform code, e.g. "2100". */
  roofTypeCode: string | null
  measuredHeight: number | null
  storeysAboveGround: number | null
  storeysBelowGround: number | null
  /** `gen:stringAttribute` / `gen:doubleAttribute` / `gen:intAttribute`, verbatim. */
  attributes: Record<string, string>
  address: RawAddress | null
  surfaces: Surface[]
  /** `bldg:lod2TerrainIntersection` linestrings, flat xyz each. */
  terrainIntersection: number[][]
  /** `srsName` in effect for this feature, e.g. "urn:adv:crs:ETRS89_UTM32*DE_DHHN2016_NH". */
  srsName: string | null
  /** Tile the record came from, for provenance. */
  sourceTile: string | null
}

/** One planar roof face, the energy-relevant unit. */
export interface RoofPlane {
  idx: number
  /** True area in 3D, m². */
  area3d: number
  /** Area of the horizontal projection, m². */
  areaProjected: number
  /** Compass bearing the face looks toward: 0 = grid north, 90 = east. Null when horizontal. */
  azimuth: number | null
  /** Degrees from horizontal: 0 = flat, 90 = vertical. */
  tilt: number
}

export type BuildingFlag =
  | 'no-geometry'
  | 'no-ground-surface'
  | 'no-roof-surface'
  | 'solid-not-closed'
  | 'degenerate-polygon'
  | 'ground-z-spread'
  | 'height-mismatch'
  | 'implausible-volume'
  | 'no-terrain-curve'

export interface BuildingMetrics {
  /** Horizontal footprint area from the ground surface(s), m². */
  footprintArea: number
  roofArea3d: number
  roofAreaProjected: number
  wallArea: number
  /** Enclosed volume, m³. Only trustworthy when 'solid-not-closed' is absent. */
  volume: number
  groundZ: number | null
  minZ: number | null
  maxZ: number | null
  /** Lowest roof-surface vertex above ground, m. */
  eaveHeight: number | null
  /** Highest roof-surface vertex above ground, m. */
  ridgeHeight: number | null
  /**
   * How far the terrain climbs above the floor slab at its highest point, m.
   *
   * LoD2 models no basement (the solid starts at the slab), so this is the depth the ground
   * reaches up the walls, not anything below them. Null where the state publishes no contact
   * line.
   */
  buriedDepth: number | null
  /** Wall area standing below the terrain line, m². Null without a contact line. */
  buriedWallArea: number | null
  roofPlanes: RoofPlane[]
  surfaceCounts: Record<SurfaceKind, number>
  flags: BuildingFlag[]
}

/**
 * Transport/storage form of the geometry: coordinates rebased to a local origin so the
 * viewer can drop them straight into a BufferGeometry. UTM is already metric, so this is
 * a translation and nothing more, no projection maths in the browser.
 */
export interface BuildingMesh {
  origin: [number, number, number]
  /**
   * `bldg:lod2TerrainIntersection` rings, rebased on the same origin.
   *
   * The line where the walls meet the ground, the only height information the models carry
   * about the terrain itself, and the whole basis of the ground surface in the viewer. Berlin
   * publishes it on nearly every building; not every state does.
   */
  terrain?: number[][]
  surfaces: Array<{ kind: SurfaceKind; rings: number[][] }>
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** A source tile as advertised by a state's index, before anything is downloaded. */
export interface TileRef {
  /** Stable per-state id, derived from the filename. */
  id: string
  url: string
  sizeBytes: number
  sha256: string | null
  bbox: BBox
  sourceTs: string | null
}

/**
 * Every German state, though only Berlin has an adapter in this project.
 *
 * The full list stays because `state` is the key every tile, building and cache row is
 * filed under, and because adding a state is meant to be one adapter file rather than a
 * change to the domain types.
 */
export type StateCode =
  | 'BW' | 'BY' | 'BE' | 'BB' | 'HB' | 'HH' | 'HE' | 'MV'
  | 'NI' | 'NW' | 'RP' | 'SL' | 'SN' | 'ST' | 'SH' | 'TH'

/**
 * A state's digital orthophoto (DOP) service.
 *
 * A DOP is a top-down parallel projection in the same CRS as the building geometry, so
 * texturing a roof needs no camera model: the UV of a vertex is its (x, y) normalised
 * against the requested bbox.
 */
export interface OrthophotoService {
  wmsUrl: string
  layer: string
  /** 1.1.1 takes SRS= and 1.3.0 takes CRS=; otherwise identical for our purposes. */
  version: '1.1.1' | '1.3.0'
  /** Native ground sample distance in metres, 0.2 for Berlin's TrueDOP. */
  gsdM: number
  /** Server-side limit on GetMap width/height. */
  maxPx: number
  /**
   * Whether this is a true orthophoto, i.e. rectified onto an image-derived surface model
   * rather than onto the terrain alone.
   *
   * Berlin's is, so roof imagery lands on the modelled roof instead of leaning outward from
   * nadir. Where it is false the roofs lean by roughly height x r/H, which is a property of
   * the source and cannot be corrected here, so the UI says so instead.
   */
  trueOrtho: boolean
  /**
   * Vintage of the imagery, for a service named after its flight year.
   *
   * Imagery without a date is hard to reason about: a roof may have been rebuilt, a garden
   * paved, a whole estate finished since the flight. Berlin publishes one WMS per year
   * (`truedop_2026`) and none of them answer GetFeatureInfo, so the year is all there is. It is
   * coarser than a per-tile date but it is true and it is known, which beats the "not stated"
   * the panel would otherwise show.
   */
  acquiredAt?: string
  attribution: string
  licence: string
}

export interface StateAdapter {
  code: StateCode
  name: string
  /** EPSG code of the source data; the eastern states, Berlin among them, use 25833. */
  epsg: 25832 | 25833
  /** The licence requires this to be shown in the UI. */
  attribution: string
  /** Edge length of one source tile in metres. */
  tileSizeM: number
  /** Files at or below this size carry no buildings and need never be downloaded. */
  emptyTileMaxBytes: number
  /**
   * Set when tiles are ZIP archives rather than bare GML, matching the member to read.
   *
   * Berlin ships `LoD2_389_5819.zip` holding the CityGML next to other members, so the
   * fetcher has to be told which one is the data.
   */
  archiveMember?: RegExp
  /**
   * Set when the index advertises rounded or absent sizes rather than exact byte counts.
   *
   * The number may still detect change and still identify empty tiles, but it must not be
   * used to validate a cached download, which is an exact-byte check.
   */
  sizesAreApproximate?: boolean
  /** Fetch and parse the state's tile index. Downloads no GML. */
  listTiles(): Promise<TileRef[]>
  /** Absent for states whose DOP is not wired up; those keep the flat roof colour. */
  orthophoto?: OrthophotoService
}
