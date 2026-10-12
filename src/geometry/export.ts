import { DEFAULT_ASSIGNMENT, defaultConstructions } from "./constructions";
import { computeEnergy } from "./energy";
import { withComputedU } from "./layers";
import { roofOf } from "./roof";
import { validateRadiator } from "./hvac";
import type { EnergySummary } from "./energy";
import { validateOpening } from "./openings";
import {
  area,
  distance,
  isCounterClockwise,
  isSimplePolygon,
  pointInPolygon,
  edges,
} from "./polygon";
import type {
  Building,
  Construction,
  EnergyCarrier,
  Opening,
  ProjectStage,
  Room,
  Storey,
  Zone,
} from "./types";
import { PROJECT_STAGES } from "./project";
import { HEATED_TEMPERATURE } from "./types";

export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: "bauwerk";
  version: number;
  building: Building;
  /** Computed from the building on export. Ignored on import and recomputed. */
  derived?: { energy: Omit<EnergySummary, "elements"> };
}

export type ImportErrorCode =
  | "invalidJson"
  | "notBauwerkFile"
  | "unsupportedVersion"
  | "invalidStructure"
  | "duplicateId"
  | "footprintInvalid"
  | "footprintNotCounterClockwise"
  | "wallThicknessInvalid"
  | "storeyHeightInvalid"
  | "wallIndexOutOfRange"
  | "openingOutsideWall"
  | "openingsOverlap"
  | "openingTooTall"
  | "doorNotOnFloor"
  | "openingTooSmall"
  | "roomOutsideFootprint"
  | "roomAreaMismatch"
  | "unknownZone"
  | "unknownConstruction"
  | "constructionInvalid"
  | "originInvalid"
  | "roofInvalid"
  | "radiatorInvalid"
  | "heatPumpInvalid"
  | "sharedEdgeInvalid";

export interface ImportError {
  code: ImportErrorCode;
  /** Where in the file the problem is, for example "storeys[1].openings[0]". */
  path?: string;
}

export type ImportResult = { ok: true; building: Building } | { ok: false; error: ImportError };

/** Pretty JSON, always with a dot as decimal separator, in metres. */
export function toJson(building: Building): string {
  const summary = computeEnergy(building);
  const energy = { ...summary, elements: undefined };
  delete energy.elements;
  const file: ExportFile = {
    format: "bauwerk",
    version: EXPORT_VERSION,
    building,
    derived: { energy },
  };
  return JSON.stringify(file, null, 2);
}

export function fromJson(text: string, language: "en" | "de" = "en"): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "invalidJson" } };
  }
  if (!isRecord(raw) || raw.format !== "bauwerk") {
    return { ok: false, error: { code: "notBauwerkFile" } };
  }
  if (raw.version !== EXPORT_VERSION) {
    return { ok: false, error: { code: "unsupportedVersion" } };
  }
  const structural = checkBuildingShape(raw.building, "building");
  if (structural) return { ok: false, error: structural };
  const building = migrate(raw.building as LegacyBuilding, language);
  const invariant = validateBuilding(building);
  if (invariant) return { ok: false, error: invariant };
  return { ok: true, building };
}

/** A building written before the energy layer: the energy fields may be missing. */
type LegacyBuilding = Omit<
  Building,
  | "constructions"
  | "wallConstructionId"
  | "floorConstructionId"
  | "roofConstructionId"
  | "windowConstructionId"
  | "doorConstructionId"
  | "zones"
  | "storeys"
> &
  Partial<
    Pick<
      Building,
      | "constructions"
      | "wallConstructionId"
      | "floorConstructionId"
      | "roofConstructionId"
      | "windowConstructionId"
      | "doorConstructionId"
    >
  > & {
    zones: (Omit<Zone, "heated" | "temperature"> & Partial<Pick<Zone, "heated" | "temperature">>)[];
    storeys: (Omit<Storey, "openings"> & {
      openings: (Omit<Opening, "constructionId"> & Partial<Pick<Opening, "constructionId">>)[];
    })[];
  };

/**
 * Fills in energy fields for files written before they existed: the uninsulated
 * preset stock, every zone heated, every opening on the default glazing or door.
 * A file that already has the fields passes through unchanged.
 */
export function migrate(b: LegacyBuilding, language: "en" | "de"): Building {
  // Layered constructions carry their computed U, whatever the file says.
  const constructionsById = new Map(
    defaultConstructions(language).map((construction) => [construction.id, construction]),
  );
  for (const construction of b.constructions ?? []) {
    constructionsById.set(construction.id, withComputedU(construction));
  }
  const constructions = [...constructionsById.values()];
  const assignment = {
    wallConstructionId: b.wallConstructionId ?? DEFAULT_ASSIGNMENT.wallConstructionId,
    floorConstructionId: b.floorConstructionId ?? DEFAULT_ASSIGNMENT.floorConstructionId,
    roofConstructionId: b.roofConstructionId ?? DEFAULT_ASSIGNMENT.roofConstructionId,
    windowConstructionId: b.windowConstructionId ?? DEFAULT_ASSIGNMENT.windowConstructionId,
    doorConstructionId: b.doorConstructionId ?? DEFAULT_ASSIGNMENT.doorConstructionId,
  };
  return {
    ...b,
    ...assignment,
    constructions,
    zones: b.zones.map((z) => ({
      ...z,
      heated: z.heated ?? true,
      temperature: z.temperature ?? HEATED_TEMPERATURE,
    })),
    storeys: b.storeys.map((s) => {
      return {
        ...s,
        rooms: s.rooms.map((room) => ({
          ...room,
          area: Math.round(area(room.polygon) * 1e6) / 1e6,
        })),
        openings: s.openings.map((o) => ({
          ...o,
          constructionId:
            o.constructionId ??
            (o.kind === "door" ? assignment.doorConstructionId : assignment.windowConstructionId),
        })),
      };
    }),
  };
}

/** Checks every invariant from INFO.md. Returns the first violation or null. */
export function validateBuilding(b: Building): ImportError | null {
  if (!isSimplePolygon(b.footprint))
    return { code: "footprintInvalid", path: "building.footprint" };
  if (!isCounterClockwise(b.footprint)) {
    return { code: "footprintNotCounterClockwise", path: "building.footprint" };
  }
  if (!(b.wallThickness > 0))
    return { code: "wallThicknessInvalid", path: "building.wallThickness" };

  if (
    b.origin &&
    (![b.origin.lat, b.origin.lon, b.origin.rotation].every(Number.isFinite) ||
      b.origin.lat < -90 ||
      b.origin.lat > 90 ||
      b.origin.lon < -180 ||
      b.origin.lon > 180 ||
      b.origin.rotation < 0 ||
      b.origin.rotation >= 360)
  ) {
    return { code: "originInvalid", path: "building.origin" };
  }

  if (b.roof) {
    const r = roofOf(b);
    if (r.pitch < 0 || r.pitch > 80 || r.overhang < 0 || r.parapet < 0) {
      return { code: "roofInvalid", path: "building.roof" };
    }
  }

  const ids = new Set<string>();
  const seen = (id: string, path: string): ImportError | null => {
    if (ids.has(id)) return { code: "duplicateId", path };
    ids.add(id);
    return null;
  };
  const dup = seen(b.id, "building.id");
  if (dup) return dup;
  const zoneIds = new Set(b.zones.map((z) => z.id));
  for (const [zi, z] of b.zones.entries()) {
    const d = seen(z.id, `building.zones[${zi}]`);
    if (d) return d;
  }

  const constructionIds = new Set<string>();
  for (const [ci, c] of b.constructions.entries()) {
    const cp = `building.constructions[${ci}]`;
    const d = seen(c.id, cp);
    if (d) return d;
    if (!(c.uValue > 0) || !c.name) return { code: "constructionInvalid", path: cp };
    for (const [li, l] of (c.layers ?? []).entries()) {
      if (!(l.thickness > 0) || !(l.conductivity > 0)) {
        return { code: "constructionInvalid", path: `${cp}.layers[${li}]` };
      }
    }
    constructionIds.add(c.id);
  }
  for (const key of [
    "wallConstructionId",
    "floorConstructionId",
    "roofConstructionId",
    "windowConstructionId",
    "doorConstructionId",
  ] as const) {
    if (!constructionIds.has(b[key]))
      return { code: "unknownConstruction", path: `building.${key}` };
  }

  for (const [hi, h] of (b.heatPumps ?? []).entries()) {
    const hp = `building.heatPumps[${hi}]`;
    const d = seen(h.id, hp);
    if (d) return d;
    if (!(h.power > 0) || pointInPolygon(h.position, b.footprint))
      return { code: "heatPumpInvalid", path: hp };
  }

  for (const [si, sc] of (b.scenarios ?? []).entries()) {
    const sp = `building.scenarios[${si}]`;
    const d = seen(sc.id, sp);
    if (d) return d;
    if (
      sc.heating &&
      (!CARRIER_NAMES.includes(sc.heating.carrier) ||
        !(sc.heating.efficiency > 0) ||
        !(sc.heating.hotWater >= 0))
    )
      return { code: "invalidStructure", path: `${sp}.heating` };
    for (const id of Object.values(sc.overrides) as (string | undefined)[]) {
      if (id !== undefined && !constructionIds.has(id))
        return { code: "unknownConstruction", path: sp };
    }
  }

  const wallLengths = edges(b.footprint).map((e) => e.length);
  for (const [i, e] of (b.sharedEdges ?? []).entries()) {
    if (e < 0 || e >= wallLengths.length)
      return { code: "sharedEdgeInvalid", path: `building.sharedEdges[${i}]` };
  }
  const footprintArea = area(b.footprint);

  for (const [si, s] of b.storeys.entries()) {
    const sp = `building.storeys[${si}]`;
    const d = seen(s.id, sp);
    if (d) return d;
    if (!(s.height > 0)) return { code: "storeyHeightInvalid", path: `${sp}.height` };

    for (const [oi, o] of s.openings.entries()) {
      const op = `${sp}.openings[${oi}]`;
      const d2 = seen(o.id, op);
      if (d2) return d2;
      const segment = s.interiorWalls[o.wallIndex];
      const wallLength = o.interior
        ? segment && distance(segment.a, segment.b)
        : wallLengths[o.wallIndex];
      if (wallLength === undefined) return { code: "wallIndexOutOfRange", path: op };
      if (!constructionIds.has(o.constructionId)) return { code: "unknownConstruction", path: op };
      const errors = validateOpening(o, {
        wallLength,
        storeyHeight: s.height,
        siblings: s.openings,
      });
      const first = errors[0];
      if (first !== undefined) return { code: openingCode(first), path: op };
    }

    for (const [ri, rad] of (s.radiators ?? []).entries()) {
      const rp = `${sp}.radiators[${ri}]`;
      const d4 = seen(rad.id, rp);
      if (d4) return d4;
      const wallLength = wallLengths[rad.wallIndex];
      if (wallLength === undefined || !validateRadiator(rad, s, wallLength)) {
        return { code: "radiatorInvalid", path: rp };
      }
    }
    for (const [mi, m] of (s.measurements ?? []).entries()) {
      const d6 = seen(m.id, `${sp}.measurements[${mi}]`);
      if (d6) return d6;
    }
    for (const [pi, pipe] of (s.pipes ?? []).entries()) {
      const pp = `${sp}.pipes[${pi}]`;
      const d5 = seen(pipe.id, pp);
      if (d5) return d5;
      if (pipe.points.length < 2) return { code: "invalidStructure", path: pp };
    }

    let sum = 0;
    for (const [ri, r] of s.rooms.entries()) {
      const rp = `${sp}.rooms[${ri}]`;
      const d3 = seen(r.id, rp);
      if (d3) return d3;
      if (!r.polygon.every((p) => pointInPolygon(p, b.footprint))) {
        return { code: "roomOutsideFootprint", path: rp };
      }
      if (r.zoneId !== undefined && !zoneIds.has(r.zoneId))
        return { code: "unknownZone", path: rp };
      sum += area(r.polygon);
    }
    // Rooms are derived, so a storey without rooms is acceptable and gets them recomputed.
    if (s.rooms.length > 0 && Math.abs(sum - footprintArea) > 1e-4) {
      return { code: "roomAreaMismatch", path: `${sp}.rooms` };
    }
  }
  return null;
}

function openingCode(err: ReturnType<typeof validateOpening>[number]): ImportErrorCode {
  switch (err) {
    case "outsideWallStart":
    case "outsideWallEnd":
      return "openingOutsideWall";
    case "overlaps":
      return "openingsOverlap";
    case "tooTall":
    case "negativeSill":
      return "openingTooTall";
    case "doorNotOnFloor":
      return "doorNotOnFloor";
    case "tooSmall":
      return "openingTooSmall";
    case "nonFinite":
      return "invalidStructure";
  }
}

// Structural checks. Hand written on purpose: the shape is small and a schema
// library would be the only runtime dependency of the geometry layer.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === "string";

const bad = (path: string): ImportError => ({ code: "invalidStructure", path });

const SOURCE_KINDS: readonly string[] = ["lod2", "photo", "catalogue", "estimate", "typed"];

function checkVec2(v: unknown, path: string): ImportError | null {
  if (!isRecord(v) || !isNumber(v.x) || !isNumber(v.y)) return bad(path);
  return null;
}

function checkPolygon(v: unknown, path: string): ImportError | null {
  if (!Array.isArray(v)) return bad(path);
  for (const [i, p] of v.entries()) {
    const e = checkVec2(p, `${path}[${i}]`);
    if (e) return e;
  }
  return null;
}

function checkSegment(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  return checkVec2(v.a, `${path}.a`) ?? checkVec2(v.b, `${path}.b`);
}

function checkOpening(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const o = v as Partial<Record<keyof Opening, unknown>>;
  if (!isString(o.id)) return bad(`${path}.id`);
  if (!isNumber(o.wallIndex) || !Number.isInteger(o.wallIndex)) return bad(`${path}.wallIndex`);
  if (o.kind !== "window" && o.kind !== "door") return bad(`${path}.kind`);
  if (o.interior !== undefined && typeof o.interior !== "boolean") return bad(`${path}.interior`);
  for (const k of ["offset", "width", "height", "sill"] as const) {
    if (!isNumber(o[k])) return bad(`${path}.${k}`);
  }
  if (o.constructionId !== undefined && !isString(o.constructionId))
    return bad(`${path}.constructionId`);
  return null;
}

function checkRoom(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const r = v as Partial<Record<keyof Room, unknown>>;
  if (!isString(r.id)) return bad(`${path}.id`);
  if (!isString(r.name)) return bad(`${path}.name`);
  if (!isNumber(r.area)) return bad(`${path}.area`);
  if (r.zoneId !== undefined && !isString(r.zoneId)) return bad(`${path}.zoneId`);
  return checkPolygon(r.polygon, `${path}.polygon`);
}

function checkStorey(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const s = v as Partial<Record<keyof Storey, unknown>>;
  if (!isString(s.id)) return bad(`${path}.id`);
  if (!isString(s.name)) return bad(`${path}.name`);
  if (!isNumber(s.height)) return bad(`${path}.height`);
  if (!Array.isArray(s.openings) || !Array.isArray(s.interiorWalls) || !Array.isArray(s.rooms)) {
    return bad(path);
  }
  for (const [i, o] of s.openings.entries()) {
    const e = checkOpening(o, `${path}.openings[${i}]`);
    if (e) return e;
  }
  for (const [i, w] of (s.interiorWalls as unknown[]).entries()) {
    const e = checkSegment(w, `${path}.interiorWalls[${i}]`);
    if (e) return e;
    const type = (w as { constructionId?: unknown }).constructionId;
    if (type !== undefined && !isString(type))
      return bad(`${path}.interiorWalls[${i}].constructionId`);
  }
  for (const [i, r] of s.rooms.entries()) {
    const e = checkRoom(r, `${path}.rooms[${i}]`);
    if (e) return e;
  }
  if (s.radiators !== undefined) {
    if (!Array.isArray(s.radiators)) return bad(`${path}.radiators`);
    for (const [i, r] of (s.radiators as unknown[]).entries()) {
      if (
        !isRecord(r) ||
        !isString(r.id) ||
        !isNumber(r.wallIndex) ||
        !isNumber(r.offset) ||
        !isNumber(r.width) ||
        !isNumber(r.height) ||
        !isNumber(r.power)
      ) {
        return bad(`${path}.radiators[${i}]`);
      }
    }
  }
  if (s.measurements !== undefined) {
    if (!Array.isArray(s.measurements)) return bad(`${path}.measurements`);
    for (const [i, m] of (s.measurements as unknown[]).entries()) {
      if (!isRecord(m) || !isString(m.id)) return bad(`${path}.measurements[${i}]`);
      const e = checkSegment(m, `${path}.measurements[${i}]`);
      if (e) return e;
    }
  }
  if (s.pipes !== undefined) {
    if (!Array.isArray(s.pipes)) return bad(`${path}.pipes`);
    for (const [i, p] of (s.pipes as unknown[]).entries()) {
      if (!isRecord(p) || !isString(p.id)) return bad(`${path}.pipes[${i}]`);
      const e = checkPolygon(p.points, `${path}.pipes[${i}].points`);
      if (e) return e;
    }
  }
  return null;
}

function checkZone(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const z = v as Partial<Record<keyof Zone, unknown>>;
  if (!isString(z.id) || !isString(z.name) || !isString(z.color)) return bad(path);
  if (z.heated !== undefined && typeof z.heated !== "boolean") return bad(`${path}.heated`);
  if (z.temperature !== undefined && !isNumber(z.temperature)) return bad(`${path}.temperature`);
  return null;
}

const NOTE_TARGETS: readonly string[] = ["building", "wall", "opening", "room", "storey"];

const CARRIER_NAMES: readonly string[] = [
  "gas",
  "oil",
  "liquidGas",
  "districtHeat",
  "pellets",
  "heatPumpAir",
  "heatPumpGround",
  "electric",
] satisfies readonly EnergyCarrier[];

/** The building has the shape of one (types and required fields), whatever its values. */
export function checkBuildingShape(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const b = v as Partial<Record<keyof Building, unknown>>;
  if (!isString(b.id)) return bad(`${path}.id`);
  if (!isString(b.name)) return bad(`${path}.name`);
  if (!isNumber(b.wallThickness)) return bad(`${path}.wallThickness`);
  if (b.bridgeDetail !== undefined && b.bridgeDetail !== "good" && b.bridgeDetail !== "poor") {
    return bad(`${path}.bridgeDetail`);
  }
  if (b.bridgeMethod !== undefined && b.bridgeMethod !== "flat" && b.bridgeMethod !== "detailed")
    return bad(`${path}.bridgeMethod`);
  if (b.factorSet !== undefined && b.factorSet !== "geg2024" && b.factorSet !== "gmodg2027")
    return bad(`${path}.factorSet`);
  if (
    b.bridgeSurcharge !== undefined &&
    (!isNumber(b.bridgeSurcharge) || b.bridgeSurcharge < 0 || b.bridgeSurcharge > 1)
  )
    return bad(`${path}.bridgeSurcharge`);
  if (
    b.yearBuilt !== undefined &&
    (!isNumber(b.yearBuilt) || !Number.isInteger(b.yearBuilt) || b.yearBuilt < 1000)
  )
    return bad(`${path}.yearBuilt`);
  if (b.livingArea !== undefined && (!isNumber(b.livingArea) || b.livingArea <= 0))
    return bad(`${path}.livingArea`);
  if (b.roof !== undefined) {
    if (!isRecord(b.roof)) return bad(`${path}.roof`);
    const r = b.roof;
    if (r.kind !== undefined && !["flat", "gable", "hip"].includes(r.kind as string))
      return bad(`${path}.roof.kind`);
    for (const k of ["pitch", "overhang", "parapet"]) {
      if (r[k] !== undefined && !isNumber(r[k])) return bad(`${path}.roof.${k}`);
    }
    if (r.ridgeAxis !== undefined && r.ridgeAxis !== "x" && r.ridgeAxis !== "y")
      return bad(`${path}.roof.ridgeAxis`);
    if (r.heatedAttic !== undefined && typeof r.heatedAttic !== "boolean")
      return bad(`${path}.roof.heatedAttic`);
  }
  if (b.origin !== undefined) {
    if (!isRecord(b.origin)) return bad(`${path}.origin`);
    for (const k of ["lat", "lon", "rotation"])
      if (!isNumber(b.origin[k])) return bad(`${path}.origin.${k}`);
  }
  const fp = checkPolygon(b.footprint, `${path}.footprint`);
  if (fp) return fp;
  if (!Array.isArray(b.storeys) || !Array.isArray(b.zones)) return bad(path);
  if (b.sharedEdges !== undefined) {
    if (!Array.isArray(b.sharedEdges)) return bad(`${path}.sharedEdges`);
    if (!b.sharedEdges.every((e) => isNumber(e) && Number.isInteger(e)))
      return bad(`${path}.sharedEdges`);
  }
  if (b.facadeColor !== undefined) {
    if (!isString(b.facadeColor) || !/^#[0-9a-f]{6}$/i.test(b.facadeColor))
      return bad(`${path}.facadeColor`);
  }
  if (b.project !== undefined) {
    const pr = b.project;
    if (!isRecord(pr)) return bad(`${path}.project`);
    for (const k of ["gid", "address", "use", "client", "reportAt", "localId"]) {
      if (pr[k] !== undefined && !isString(pr[k])) return bad(`${path}.project.${k}`);
    }
    if (pr.stage !== undefined && !PROJECT_STAGES.includes(pr.stage as ProjectStage))
      return bad(`${path}.project.stage`);
  }
  if (b.heating !== undefined) {
    const h = b.heating;
    if (!isRecord(h) || !CARRIER_NAMES.includes(h.carrier as string)) return bad(`${path}.heating`);
    if (!isNumber(h.efficiency) || h.efficiency <= 0 || h.efficiency > 8)
      return bad(`${path}.heating.efficiency`);
    if (!isNumber(h.hotWater) || h.hotWater < 0) return bad(`${path}.heating.hotWater`);
    if (
      h.hotWaterEfficiency !== undefined &&
      (!isNumber(h.hotWaterEfficiency) || h.hotWaterEfficiency <= 0 || h.hotWaterEfficiency > 8)
    )
      return bad(`${path}.heating.hotWaterEfficiency`);
    if (
      h.distributionLoss !== undefined &&
      (!isNumber(h.distributionLoss) || h.distributionLoss < 0 || h.distributionLoss > 1)
    )
      return bad(`${path}.heating.distributionLoss`);
  }
  if (b.economics !== undefined) {
    const e = b.economics;
    if (!isRecord(e)) return bad(`${path}.economics`);
    if (e.co2Price !== undefined && (!isNumber(e.co2Price) || e.co2Price < 0))
      return bad(`${path}.economics.co2Price`);
    if (e.dwellings !== undefined && (!isNumber(e.dwellings) || e.dwellings < 1))
      return bad(`${path}.economics.dwellings`);
    if (e.consumption !== undefined && (!isNumber(e.consumption) || e.consumption < 0))
      return bad(`${path}.economics.consumption`);
    for (const k of ["ownerOccupied", "isfp"]) {
      if (e[k] !== undefined && typeof e[k] !== "boolean") return bad(`${path}.economics.${k}`);
    }
    if (e.prices !== undefined) {
      if (!isRecord(e.prices)) return bad(`${path}.economics.prices`);
      for (const [carrier, price] of Object.entries(e.prices)) {
        if (!CARRIER_NAMES.includes(carrier) || !isNumber(price) || price < 0)
          return bad(`${path}.economics.prices.${carrier}`);
      }
    }
  }
  if (b.notes !== undefined) {
    if (!Array.isArray(b.notes)) return bad(`${path}.notes`);
    for (const [i, n] of b.notes.entries()) {
      const np = `${path}.notes[${i}]`;
      if (!isRecord(n) || !isString(n.id) || !isString(n.author) || !isString(n.createdAt))
        return bad(np);
      if (!isString(n.text) || n.text.length > 4000) return bad(`${np}.text`);
      if (n.done !== undefined && typeof n.done !== "boolean") return bad(`${np}.done`);
      if (!isRecord(n.target) || !NOTE_TARGETS.includes(n.target.kind as string))
        return bad(`${np}.target`);
    }
  }
  if (b.sources !== undefined) {
    if (!isRecord(b.sources)) return bad(`${path}.sources`);
    for (const [key, source] of Object.entries(b.sources)) {
      const sp = `${path}.sources.${key}`;
      if (!isRecord(source) || !SOURCE_KINDS.includes(source.kind as string)) return bad(sp);
      if (source.note !== undefined && !isString(source.note)) return bad(`${sp}.note`);
      if (source.photo !== undefined && !isString(source.photo)) return bad(`${sp}.photo`);
      if (
        source.value !== undefined &&
        (!Array.isArray(source.value) || !source.value.every((v) => isNumber(v) || isString(v)))
      )
        return bad(`${sp}.value`);
    }
  }
  if (b.scenarios !== undefined) {
    if (!Array.isArray(b.scenarios)) return bad(`${path}.scenarios`);
    for (const [i, sc] of (b.scenarios as unknown[]).entries()) {
      if (!isRecord(sc) || !isString(sc.id) || !isString(sc.name) || !isRecord(sc.overrides))
        return bad(`${path}.scenarios[${i}]`);
      if (!Object.values(sc.overrides).every((v) => v === undefined || isString(v)))
        return bad(`${path}.scenarios[${i}].overrides`);
    }
  }
  if (b.heatPumps !== undefined) {
    if (!Array.isArray(b.heatPumps)) return bad(`${path}.heatPumps`);
    for (const [i, h] of (b.heatPumps as unknown[]).entries()) {
      if (
        !isRecord(h) ||
        !isString(h.id) ||
        !isNumber(h.power) ||
        (h.kind !== "air" && h.kind !== "ground")
      ) {
        return bad(`${path}.heatPumps[${i}]`);
      }
      const e = checkVec2(h.position, `${path}.heatPumps[${i}].position`);
      if (e) return e;
    }
  }
  for (const [i, s] of b.storeys.entries()) {
    const e = checkStorey(s, `${path}.storeys[${i}]`);
    if (e) return e;
  }
  for (const [i, z] of b.zones.entries()) {
    const e = checkZone(z, `${path}.zones[${i}]`);
    if (e) return e;
  }
  if (b.constructions !== undefined) {
    if (!Array.isArray(b.constructions)) return bad(`${path}.constructions`);
    for (const [i, c] of (b.constructions as unknown[]).entries()) {
      const e = checkConstruction(c, `${path}.constructions[${i}]`);
      if (e) return e;
    }
  }
  for (const key of [
    "wallConstructionId",
    "floorConstructionId",
    "roofConstructionId",
    "windowConstructionId",
    "doorConstructionId",
  ] as const) {
    if (b[key] !== undefined && !isString(b[key])) return bad(`${path}.${key}`);
  }
  return null;
}

function checkConstruction(v: unknown, path: string): ImportError | null {
  if (!isRecord(v)) return bad(path);
  const c = v as Partial<Record<keyof Construction, unknown>>;
  if (!isString(c.id) || !isString(c.name)) return bad(path);
  if (!["wall", "interiorWall", "window", "door", "floor", "roof"].includes(c.category as string))
    return bad(`${path}.category`);
  if (!isNumber(c.uValue)) return bad(`${path}.uValue`);
  if (c.gValue !== undefined && (!isNumber(c.gValue) || c.gValue < 0 || c.gValue > 1))
    return bad(`${path}.gValue`);
  if (c.layers !== undefined) {
    if (!Array.isArray(c.layers)) return bad(`${path}.layers`);
    for (const [i, l] of (c.layers as unknown[]).entries()) {
      if (
        !isRecord(l) ||
        !isString(l.id) ||
        !isString(l.name) ||
        !isNumber(l.thickness) ||
        !isNumber(l.conductivity)
      ) {
        return bad(`${path}.layers[${i}]`);
      }
    }
  }
  return null;
}
