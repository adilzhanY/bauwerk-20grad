export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

export type OpeningKind = "window" | "door";

export type ConstructionCategory = "wall" | "window" | "door" | "floor" | "roof";

/** One material layer of a construction, from outside to inside. */
export interface Layer {
  id: Id;
  name: string;
  /** Metres. */
  thickness: number;
  /** Thermal conductivity λ in W/(m·K). */
  conductivity: number;
}

/** A building component type with its thermal transmittance. */
export interface Construction {
  id: Id;
  name: string;
  category: ConstructionCategory;
  /** U-value in W/(m²K). Computed from the layers when they exist. */
  uValue: number;
  /** Layer stack from outside to inside. Walls, roofs and floors; windows and doors have none. */
  layers?: Layer[];
}

export interface Opening {
  id: Id;
  /**
   * Index into the footprint edges (edge i runs from vertex i to vertex i + 1), or,
   * when `interior` is set, into the storey's interior walls.
   */
  wallIndex: number;
  /** The opening sits in an interior wall instead of the building envelope. */
  interior?: boolean;
  kind: OpeningKind;
  /** Metres from the wall start to the opening's left edge. */
  offset: number;
  width: number;
  height: number;
  /** Metres above the floor. Always 0 for doors. */
  sill: number;
  constructionId: Id;
}

export interface Room {
  id: Id;
  name: string;
  /** Derived from the interior walls. */
  polygon: Vec2[];
  /** Derived, square metres. */
  area: number;
  zoneId?: Id;
}

export interface Zone {
  id: Id;
  name: string;
  color: string;
  heated: boolean;
  /** Indoor design temperature in °C. */
  temperature: number;
}

export interface Storey {
  id: Id;
  name: string;
  /** Metres. */
  height: number;
  openings: Opening[];
  /** On the grid. Define the rooms. */
  interiorWalls: Segment[];
  rooms: Room[];
  /** Radiators on exterior walls. Optional for files written before HVAC existed. */
  radiators?: Radiator[];
  /** Pipe runs on the floor, polylines on the grid. */
  pipes?: PipeRun[];
}

/** A radiator hung on the inner face of an exterior wall. */
export interface Radiator {
  id: Id;
  wallIndex: number;
  /** Metres from the wall start to the radiator's left edge. */
  offset: number;
  width: number;
  height: number;
  /** Heat output in watts at design conditions. */
  power: number;
}

export interface PipeRun {
  id: Id;
  points: Vec2[];
}

export interface HeatPump {
  id: Id;
  /** Plan position outside the footprint. */
  position: Vec2;
  /** Heating capacity in kilowatts. */
  power: number;
  kind: "air" | "ground";
}

export interface Building {
  id: Id;
  name: string;
  /** Closed simple polygon, counter-clockwise, metres. The closing edge is implicit. */
  footprint: Vec2[];
  /** Metres. */
  wallThickness: number;
  /** Index 0 is the ground floor. */
  storeys: Storey[];
  zones: Zone[];
  constructions: Construction[];
  wallConstructionId: Id;
  floorConstructionId: Id;
  roofConstructionId: Id;
  /** Used for newly placed openings. */
  windowConstructionId: Id;
  doorConstructionId: Id;
  /** Where the plan origin sits on the earth. Optional. */
  origin?: GeoOrigin;
  /** Thermal bridge detailing level. Missing means "poor", the uninsulated stock. */
  bridgeDetail?: "good" | "poor";
  /** Roof over the top storey. Missing means a flat roof with a 0.3 m parapet. */
  roof?: Partial<Roof>;
  heatPumps?: HeatPump[];
  /** Renovation variants as override sets, see geometry/scenarios.ts. */
  scenarios?: Scenario[];
  /**
   * Footprint edges that stand against a heated neighbour, a party wall. They lose no heat.
   * See geometry/shared.ts.
   */
  sharedEdges?: number[];
  /** Where imported values came from, by value path. See geometry/sources.ts. */
  sources?: Record<string, ValueSource>;
}

export interface Scenario {
  id: Id;
  name: string;
  overrides: Partial<Record<ConstructionCategory, Id>>;
  bridgeDetail?: "good" | "poor";
  roof?: Partial<Roof>;
}

export interface Roof {
  kind: "flat" | "gable" | "hip";
  /** Degrees from horizontal. */
  pitch: number;
  /** Metres beyond the footprint at the eaves. */
  overhang: number;
  /** Axis the ridge runs along. */
  ridgeAxis: "x" | "y";
  /** Flat roofs: parapet height in metres. */
  parapet: number;
  /** Count the attic as heated volume. */
  heatedAttic: boolean;
}

/** Where a value of the building came from, when it was brought in rather than drawn. */
export type SourceKind = "lod2" | "photo" | "catalogue" | "estimate" | "typed";

export interface ValueSource {
  kind: SourceKind;
  /** What was assumed or changed on the way. */
  note?: string;
  /** File name of the photo a measured value was read from. */
  photo?: string;
  /**
   * The value as it was brought in, in the canonical form of `sourceValue` in
   * geometry/sources.ts. While the building still has this value the source holds; once it
   * differs, the value counts as edited.
   */
  value?: (number | string)[];
}

export interface GeoOrigin {
  lat: number;
  lon: number;
  /** Compass bearing of the plan's +y axis, degrees clockwise from north. */
  rotation: number;
}

export const GRID_SIZE = 0.5;
export const DEFAULT_WALL_THICKNESS = 0.3;
export const DEFAULT_STOREY_HEIGHT = 3;
export const HEATED_TEMPERATURE = 20;
export const UNHEATED_TEMPERATURE = 10;
