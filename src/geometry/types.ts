export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}

/** An interior wall: its centre line, and its type (a construction of kind "interiorWall"). */
export interface InteriorWall extends Segment {
  /** Unset for the default type, a brick partition (geometry/constructions.ts). */
  constructionId?: Id;
}

/** How thick an interior wall of a given type is, metres. A wall with no type is the default. */
export type ThicknessOf = (wall: { constructionId?: Id }) => number;

export type OpeningKind = "window" | "door";

/** The building envelope: each kind has one construction assigned to the whole building. */
export type ConstructionCategory = "wall" | "window" | "door" | "floor" | "roof";
/** Every kind of construction: the envelope's, and interior wall types, chosen wall by wall. */
export type ConstructionKind = ConstructionCategory | "interiorWall";

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
  category: ConstructionKind;
  /** U-value in W/(m²K). Computed from the layers when they exist. */
  uValue: number;
  /** Layer stack from outside to inside. Walls, roofs and floors; windows and doors have none. */
  layers?: Layer[];
  /** Windows: total solar energy transmittance g of the glazing. Missing takes the window type's. */
  gValue?: number;
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
  /** Centre lines, as pieces from joint to joint. Define the rooms. */
  interiorWalls: InteriorWall[];
  rooms: Room[];
  /** Radiators on exterior walls. Optional for files written before HVAC existed. */
  radiators?: Radiator[];
  /** Pipe runs on the floor, polylines on the grid. */
  pipes?: PipeRun[];
  /** Distances measured on the plan and kept, from the measure tool. Optional for older files. */
  measurements?: Measurement[];
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

/** A distance measured on the plan, between two points anywhere, in or around the building. */
export interface Measurement {
  id: Id;
  a: Vec2;
  b: Vec2;
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
  /**
   * How thermal bridges are counted: "flat" adds ΔU_WB over the whole envelope, as a
   * certificate for the existing stock does (DIN V 18599-2, GEG §24); "detailed" adds ψ·l for
   * every junction the model knows. Missing means flat.
   */
  bridgeMethod?: "flat" | "detailed";
  /** ΔU_WB in W/(m²K) for the flat method. Missing means 0.10, or 0.05 with good detailing. */
  bridgeSurcharge?: number;
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
  /** The heating system. Missing means a gas boiler, see geometry/supply.ts. */
  heating?: HeatingSystem;
  /** Which primary energy factors the building is calculated with. Missing means GEG 2024. */
  factorSet?: FactorSet;
  /** The year the building was finished; picks the default U-values (geometry/ageDefaults.ts). */
  yearBuilt?: number;
  /** Heated living area (Wohnfläche) in m², for the consumption check. Missing: A_N / 1.2. */
  livingArea?: number;
  /** Prices, the CO2 price and who lives in the building. Missing values take defaults. */
  economics?: Partial<Economics>;
  /** Notes from the site visit and the office, each on an element or the whole building. */
  notes?: Note[];
  /**
   * The colour of the facade, "#rrggbb", read from a straightened photo of one of its walls.
   * The 3D model paints every exterior wall with it; missing means the neutral wall colour.
   */
  facadeColor?: string;
  /** What the Projects page shows about this building's project. See geometry/project.ts. */
  project?: ProjectInfo;
}

/** The consultant's stages of a project, as the Projects page filters them. */
export type ProjectStage = "survey" | "variants" | "report" | "done";

export interface ProjectInfo {
  /** The Berlin Gebäude-ID, when the building came from the LoD2 map. */
  gid?: string;
  /** Street and number, as found when the project was created. */
  address?: string;
  /** What the building is used for, from the cadastre ("Wohnhaus"), for the project card. */
  use?: string;
  /** Who the consultant works for: the owner, the WEG, the property manager. */
  client?: string;
  /** Set by hand; missing means the stage follows the work done. */
  stage?: ProjectStage;
  /** When the report was last opened, ISO time. */
  reportAt?: string;
  /**
   * Without a server: the id this browser keeps the saved project under. Set by the first
   * Save; a building without it is not a saved project.
   */
  localId?: string;
}

/** What a note is about. */
export type NoteTarget =
  | { kind: "building" }
  | { kind: "wall"; wallIndex: number }
  | { kind: "opening"; storeyId: Id; id: Id }
  | { kind: "room"; storeyId: Id; id: Id }
  | { kind: "storey"; id: Id };

export interface Note {
  id: Id;
  target: NoteTarget;
  text: string;
  /** Who wrote it: the name of the editor tab, or "me" when working alone. */
  author: string;
  /** ISO time. */
  createdAt: string;
  /** Dealt with. */
  done?: boolean;
}

/** What the building burns or draws for heat. */
export type EnergyCarrier =
  | "gas"
  | "oil"
  | "liquidGas"
  | "districtHeat"
  | "pellets"
  | "heatPumpAir"
  | "heatPumpGround"
  | "electric";

export interface HeatingSystem {
  carrier: EnergyCarrier;
  /**
   * Useful heat per kWh bought: a boiler's annual efficiency (0.8 to 1), or a heat pump's
   * seasonal performance factor (JAZ, 2.5 to 5).
   */
  efficiency: number;
  /** Hot water, kWh per m² of reference area (A_N) and year. */
  hotWater: number;
  /** Hot water efficiency or performance factor. Missing: derived from `efficiency`. */
  hotWaterEfficiency?: number;
  /** Losses of pipes and storage as a share of the useful heat. Missing: 0.1. */
  distributionLoss?: number;
}

/** The primary energy factors a building is calculated with: today's, or the GModG's of 2027. */
export type FactorSet = "geg2024" | "gmodg2027";

export interface Economics {
  /** Euro per kWh of end energy, by carrier. */
  prices: Partial<Record<EnergyCarrier, number>>;
  /** Euro per tonne of CO2 under the BEHG. */
  co2Price: number;
  /** The owner lives in it; rented buildings split the CO2 cost and get less heating subsidy. */
  ownerOccupied: boolean;
  /** Number of dwellings (Wohneinheiten); the subsidy caps are per dwelling. */
  dwellings: number;
  /** A funded iSFP exists, which adds the iSFP bonus. */
  isfp: boolean;
  /**
   * Measured end energy for heating and hot water, kWh per year: the mean of the last three
   * years' bills, climate and vacancy corrected. Missing: the typical consumption is used.
   */
  consumption?: number;
}

export interface Scenario {
  id: Id;
  name: string;
  overrides: Partial<Record<ConstructionCategory, Id>>;
  bridgeDetail?: "good" | "poor";
  /** ΔU_WB after the measure, for the flat method. */
  bridgeSurcharge?: number;
  roof?: Partial<Roof>;
  /** A new heating system, for a variant that replaces it (gas boiler to heat pump). */
  heating?: HeatingSystem;
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
