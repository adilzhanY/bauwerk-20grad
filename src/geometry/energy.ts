import { bridgeDetailOf, emptyBridgeSummary, summarizeBridges } from "./bridges";
import { sharedEdgeSet } from "./shared";
import type { BridgeSummary } from "./bridges";
import { bestInCategory, findConstruction } from "./constructions";
import { buildRoof, roofOf } from "./roof";
import type { RoofGeometry } from "./roof";
import { clipSegmentToPolygon, splitSegments } from "./rooms";
import { GAIN_UTILISATION, solarGains } from "./sun";
import { openingsOn, validateOpening } from "./openings";
import { area, edges, pointInPolygon, pointOnSegment, sub, distance } from "./polygon";
import type { Edge } from "./polygon";
import type {
  Building,
  Construction,
  ConstructionCategory,
  Opening,
  Room,
  Segment,
  Storey,
  Vec2,
  Zone,
} from "./types";

/**
 * Building physics after the heating period method of DIN V 4108-6 Annex D, the
 * simplified procedure the EnEV allowed for residential buildings.
 *
 * Transmission heat loss coefficient   H_T  = Σ F_x,i · U_i · A_i + Σ ψ_j · l_j     [W/K]
 * Ventilation heat loss coefficient    H_V  = 0.34 · n · V                       [W/K], n = 0.5 1/h
 * Specific transmission loss           H_T' = H_T / A_envelope                   [W/(m²K)]
 * Annual heating demand                Q_h  = 66 kKh · (H_T + H_V) − 0.95 · (Q_s + Q_i)   [kWh/a]
 * Internal gains                       Q_i  = 22 kWh/(m²a) · A_heated
 * Specific heating demand              q_h  = Q_h / A_heated                     [kWh/(m²a)]
 *
 * F_x is the temperature correction factor of EnEV Annex 1 table 1: 1.0 for surfaces
 * to outside air, 0.6 for the floor slab on the ground, 0.5 for walls to unheated
 * rooms. V is the heated floor area times the storey height, which stands in for the
 * net air volume. Solar gains come from ./sun.ts, thermal bridges from ./bridges.ts.
 * Interior walls between a heated and an unheated room count with a fixed U of
 * 1.0 W/(m²K). Rooms without a zone count as heated. The reference climate is the
 * German one and does not change with the site; the orientation of the windows
 * does, through the geo placement's rotation, so the solar gains follow the site.
 * A storey without rooms counts as fully heated.
 */

export const AIR_HEAT_CAPACITY = 0.34; // Wh/(m³K)
export const AIR_CHANGE_RATE = 0.5; // 1/h
/** Heating degree hours of the German reference climate, DIN V 4108-6 Annex D. */
export const HEATING_DEGREE_HOURS = 66; // kKh per year
/** Internal gains per square metre of heated floor area over the heating period. */
export const INTERNAL_GAINS_PER_M2 = 22; // kWh/(m²a)
export const INTERIOR_WALL_U = 1.0; // W/(m²K)
/** Temperature correction factors F_x, EnEV Annex 1 table 1. */
export const FX_GROUND_FLOOR = 0.6;
export const FX_UNHEATED_ROOM = 0.5;

export type Orientation = "N" | "E" | "S" | "W";

export interface ElementLoss {
  category: ConstructionCategory | "interiorWall" | "bridge";
  label: string;
  area: number;
  uValue: number;
  /** U · A in W/K. */
  loss: number;
}

export interface StoreyEnvelope {
  storeyId: string;
  wallGrossArea: number;
  wallNetArea: number;
  windowArea: number;
  doorArea: number;
  floorArea: number;
  roofArea: number;
  /** Window area divided by gross wall area, per orientation. */
  windowToWall: Record<Orientation, { wall: number; window: number; ratio: number }>;
  heatedFloorArea: number;
  heatedVolume: number;
}

export interface EnergySummary {
  storeys: StoreyEnvelope[];
  envelopeArea: number;
  wallNetArea: number;
  /** Gross area of the walls against a heated neighbour. They lose no heat. */
  sharedWallArea: number;
  windowArea: number;
  doorArea: number;
  windowToWallRatio: number;
  heatedFloorArea: number;
  heatedVolume: number;
  /** Σ U·A plus the thermal bridge term. */
  transmissionLoss: number;
  /** Σ ψ·l, already included in transmissionLoss. */
  bridgeLoss: number;
  bridges: BridgeSummary;
  /** H_T divided by the heat-transferring envelope area (walls, openings, floor, roof). */
  specificTransmissionLoss: number;
  ventilationLoss: number;
  /** Usable solar gains through windows over the heating period, kWh/a. */
  solarGains: number;
  /** Usable internal gains from people and appliances, kWh/a. */
  internalGains: number;
  /** Losses times degree hours minus usable gains, never below zero. */
  heatingDemand: number;
  specificHeatingDemand: number;
  /** False when no room is heated; the demand is then zero and the class is not meaningful. */
  heated: boolean;
  energyClass: EnergyClass;
  elements: ElementLoss[];
  /** Per zone: heated floor area and transmission loss through its envelope. */
  zones: { zoneId: string | null; floorArea: number; transmissionLoss: number }[];
}

export type EnergyClass = "A+" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

/** Energieausweis bands for the specific demand in kWh/(m²a). */
export function energyClass(specificDemand: number): EnergyClass {
  if (specificDemand <= 30) return "A+";
  if (specificDemand <= 50) return "A";
  if (specificDemand <= 75) return "B";
  if (specificDemand <= 100) return "C";
  if (specificDemand <= 130) return "D";
  if (specificDemand <= 160) return "E";
  if (specificDemand <= 200) return "F";
  if (specificDemand <= 250) return "G";
  return "H";
}

export const ENERGY_CLASSES: EnergyClass[] = ["A+", "A", "B", "C", "D", "E", "F", "G", "H"];
/** Upper bound of each class on the Energieausweis scale, the last one is the drawn maximum. */
export const ENERGY_CLASS_UPPER = [30, 50, 75, 100, 130, 160, 200, 250, 300];
export const ENERGY_SCALE_MAX = 300;

export const ENERGY_CLASS_COLORS: Record<EnergyClass, string> = {
  "A+": "#1a9850",
  A: "#66bd63",
  B: "#a6d96a",
  C: "#d9ef8b",
  D: "#fee08b",
  E: "#fdae61",
  F: "#f46d43",
  G: "#d73027",
  H: "#a50026",
};

/** Compass bucket for an outward normal in plan coordinates, y pointing north. */
export function orientationOf(normal: Vec2, rotationDegrees = 0): Orientation {
  const angle = (Math.atan2(normal.x, normal.y) * 180) / Math.PI + rotationDegrees;
  const a = ((angle % 360) + 360) % 360;
  if (a < 45 || a >= 315) return "N";
  if (a < 135) return "E";
  if (a < 225) return "S";
  return "W";
}

function zoneOf(room: Room, zones: readonly Zone[]): Zone | undefined {
  return room.zoneId === undefined ? undefined : zones.find((z) => z.id === room.zoneId);
}

export function isRoomHeated(room: Room, zones: readonly Zone[]): boolean {
  const zone = zoneOf(room, zones);
  return zone ? zone.heated : true;
}

interface Span {
  from: number;
  to: number;
}

/** Portions of footprint edge `edge` (as u ranges) that border a heated room. */
function heatedSpans(edge: Edge, rooms: readonly Room[], zones: readonly Zone[]): Span[] {
  const spans: Span[] = [];
  for (const room of rooms) {
    if (!isRoomHeated(room, zones)) continue;
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % n];
      if (!a || !b) continue;
      if (!pointOnSegment(a, edge.a, edge.b) || !pointOnSegment(b, edge.a, edge.b)) continue;
      const ua = distance(a, edge.a);
      const ub = distance(b, edge.a);
      spans.push({ from: Math.min(ua, ub), to: Math.max(ua, ub) });
    }
  }
  return spans;
}

const spanLength = (spans: readonly Span[]) => spans.reduce((s, x) => s + (x.to - x.from), 0);
const inSpans = (u: number, spans: readonly Span[]) =>
  spans.some((s) => u >= s.from - 1e-6 && u <= s.to + 1e-6);

function uOf(c: Construction | undefined): number {
  return c?.uValue ?? 0;
}

export interface EnergyOptions {
  /** Swap every construction for the best one in its category: the renovated scenario. */
  renovated?: boolean;
  /** Rotation of the plan's +y axis from north, degrees, from geo placement. */
  rotationDegrees?: number;
}

export function computeEnergy(building: Building, options: EnergyOptions = {}): EnergySummary {
  const all = building.constructions;
  const pick = (id: string, category: ConstructionCategory): Construction | undefined => {
    const own = findConstruction(all, id);
    if (!options.renovated) return own;
    return bestInCategory(all, own?.category ?? category) ?? own;
  };
  const wallU = uOf(pick(building.wallConstructionId, "wall"));
  const floorU = uOf(pick(building.floorConstructionId, "floor"));
  const roofU = uOf(pick(building.roofConstructionId, "roof"));

  const footprintEdges = edges(building.footprint);
  const shared = sharedEdgeSet(building);
  let sharedWallArea = 0;
  const footprintArea = area(building.footprint);
  const storeys: StoreyEnvelope[] = [];
  const elements: ElementLoss[] = [];
  const zoneLoss = new Map<string | null, { floorArea: number; transmissionLoss: number }>();
  const addZone = (zoneId: string | null, floorArea: number, loss: number) => {
    const cur = zoneLoss.get(zoneId) ?? { floorArea: 0, transmissionLoss: 0 };
    cur.floorArea += floorArea;
    cur.transmissionLoss += loss;
    zoneLoss.set(zoneId, cur);
  };

  let transmission = 0;
  let heatedVolume = 0;
  let heatedFloorArea = 0;
  const heatedWindowsByOrientation: Record<Orientation, number> = { N: 0, E: 0, S: 0, W: 0 };

  building.storeys.forEach((storey, storeyIndex) => {
    const env = emptyEnvelope(storey.id);
    const heatedRooms = storey.rooms.filter((r) => isRoomHeated(r, building.zones));
    env.heatedFloorArea =
      storey.rooms.length === 0 ? footprintArea : heatedRooms.reduce((s, r) => s + r.area, 0);
    env.heatedVolume = env.heatedFloorArea * storey.height;
    heatedFloorArea += env.heatedFloorArea;
    heatedVolume += env.heatedVolume;

    for (const edge of footprintEdges) {
      // A party wall against a heated neighbour: same temperature on both sides, no loss.
      if (shared.has(edge.index)) {
        sharedWallArea += edge.length * storey.height;
        continue;
      }
      const spans = heatedSpans(edge, storey.rooms, building.zones);
      const heatedLength = storey.rooms.length === 0 ? edge.length : spanLength(spans);
      const onWall = openingsOn(storey.openings, edge.index);
      const valid = onWall.filter(
        (o) =>
          validateOpening(o, {
            wallLength: edge.length,
            storeyHeight: storey.height,
            siblings: onWall,
          }).length === 0,
      );
      const orientation = orientationOf(
        edge.normal,
        options.rotationDegrees ?? building.origin?.rotation ?? 0,
      );
      const gross = edge.length * storey.height;
      env.wallGrossArea += gross;
      env.windowToWall[orientation].wall += gross;

      let openingArea = 0;
      for (const o of valid) {
        const a = o.width * o.height;
        openingArea += a;
        if (o.kind === "window") {
          env.windowArea += a;
          env.windowToWall[orientation].window += a;
        } else env.doorArea += a;
        const heated = storey.rooms.length === 0 || inSpans(o.offset + o.width / 2, spans);
        if (!heated) continue;
        if (o.kind === "window") heatedWindowsByOrientation[orientation] += a;
        const u = uOf(pick(o.constructionId, o.kind));
        transmission += u * a;
        elements.push({
          category: o.kind,
          label: `${storey.name} / ${orientation}`,
          area: a,
          uValue: u,
          loss: u * a,
        });
        addZone(zoneForOpening(o, edge, storey, building.zones), 0, u * a);
      }
      env.wallNetArea += gross - openingArea;

      // Heated share of the net wall area: the heated fraction of the wall length times
      // the storey height, minus the heated openings already subtracted above.
      const heatedGross = heatedLength * storey.height;
      const heatedOpenings = valid
        .filter((o) => storey.rooms.length === 0 || inSpans(o.offset + o.width / 2, spans))
        .reduce((s, o) => s + o.width * o.height, 0);
      const heatedNet = Math.max(0, heatedGross - heatedOpenings);
      if (heatedNet > 0) {
        transmission += wallU * heatedNet;
        elements.push({
          category: "wall",
          label: `${storey.name} / ${orientation}`,
          area: heatedNet,
          uValue: wallU,
          loss: wallU * heatedNet,
        });
        distributeWallLoss(edge, storey, building.zones, wallU * heatedNet, addZone);
      }
    }

    if (storeyIndex === 0) {
      env.floorArea = footprintArea;
      const heated = env.heatedFloorArea;
      const floorLoss = FX_GROUND_FLOOR * floorU * heated;
      transmission += floorLoss;
      if (heated > 0)
        elements.push({
          category: "floor",
          label: storey.name,
          area: heated,
          uValue: floorU,
          loss: floorLoss,
        });
      for (const r of heatedRooms)
        addZone(r.zoneId ?? null, r.area, FX_GROUND_FLOOR * floorU * r.area);
    } else {
      for (const r of heatedRooms) addZone(r.zoneId ?? null, r.area, 0);
    }
    if (storeyIndex === building.storeys.length - 1) {
      // The roof's true sloped area over the footprint (the overhang is outside the
      // thermal envelope), scaled to the heated share of the plan.
      const roofGeo = thermalRoof(building);
      const slope = roofSlopeFactor(building, roofGeo);
      env.roofArea = roofGeo.area;
      const heatedPlan = env.heatedFloorArea;
      const heated = heatedPlan * slope;
      transmission += roofU * heated;
      if (heated > 0) {
        elements.push({
          category: "roof",
          label: storey.name,
          area: heated,
          uValue: roofU,
          loss: roofU * heated,
        });
      }
      for (const r of heatedRooms) addZone(r.zoneId ?? null, 0, roofU * r.area * slope);
      if (roofOf(building).heatedAttic && roofGeo.atticVolume > 0) {
        const share = footprintArea > 0 ? heatedPlan / footprintArea : 0;
        env.heatedVolume += roofGeo.atticVolume * share;
        heatedVolume += roofGeo.atticVolume * share;
      }
    }

    // Interior walls between heated and unheated rooms, piece by piece: a drawn wall
    // crossed by another one borders up to four rooms.
    for (const wall of interiorWallPieces(building.footprint, storey.interiorWalls)) {
      const between = roomsAround(wall, storey.rooms);
      if (!between) continue;
      const [left, right] = between;
      const lh = isRoomHeated(left, building.zones);
      const rh = isRoomHeated(right, building.zones);
      if (lh === rh) continue;
      const a = distance(wall.a, wall.b) * storey.height;
      const loss = FX_UNHEATED_ROOM * INTERIOR_WALL_U * a;
      transmission += loss;
      elements.push({
        category: "interiorWall",
        label: storey.name,
        area: a,
        uValue: INTERIOR_WALL_U,
        loss,
      });
      const heatedRoom = lh ? left : right;
      addZone(heatedRoom.zoneId ?? null, 0, loss);
    }

    for (const o of ["N", "E", "S", "W"] as const) {
      const b = env.windowToWall[o];
      b.ratio = b.wall > 0 ? b.window / b.wall : 0;
    }
    storeys.push(env);
  });

  const heated = heatedFloorArea > 0;
  // Heat-transferring envelope: the element areas, so H_T' divides the heated losses
  // by the heated surfaces only. Interior walls and bridges are not envelope.
  const envelopeArea = elements
    .filter((e) => e.category !== "interiorWall" && e.category !== "bridge")
    .reduce((s, e) => s + e.area, 0);
  const wallGross = storeys.reduce((s, e) => s + e.wallGrossArea, 0);
  const windowArea = storeys.reduce((s, e) => s + e.windowArea, 0);
  // Thermal bridges: the renovated scenario assumes good detailing. Nothing heated
  // means no temperature difference across them, so none are counted.
  const bridges = heated
    ? summarizeBridges(building, options.renovated ? "good" : bridgeDetailOf(building))
    : emptyBridgeSummary();
  if (bridges.total > 0) {
    transmission += bridges.total;
    elements.push({
      category: "bridge",
      label: "bridges",
      area: 0,
      uValue: 0,
      loss: bridges.total,
    });
  }
  const ventilation = AIR_HEAT_CAPACITY * AIR_CHANGE_RATE * heatedVolume;
  const gains = solarGains(heatedWindowsByOrientation);
  const internalGains = GAIN_UTILISATION * INTERNAL_GAINS_PER_M2 * heatedFloorArea;
  const heatingDemand = heated
    ? Math.max(0, (transmission + ventilation) * HEATING_DEGREE_HOURS - gains - internalGains)
    : 0;
  const specific = heatedFloorArea > 0 ? heatingDemand / heatedFloorArea : 0;

  return {
    storeys,
    envelopeArea,
    wallNetArea: storeys.reduce((s, e) => s + e.wallNetArea, 0),
    sharedWallArea,
    windowArea,
    doorArea: storeys.reduce((s, e) => s + e.doorArea, 0),
    windowToWallRatio: wallGross > 0 ? windowArea / wallGross : 0,
    heatedFloorArea,
    heatedVolume,
    transmissionLoss: transmission,
    bridgeLoss: bridges.total,
    bridges,
    specificTransmissionLoss: envelopeArea > 0 ? transmission / envelopeArea : 0,
    ventilationLoss: ventilation,
    solarGains: gains,
    internalGains,
    heatingDemand,
    specificHeatingDemand: specific,
    heated,
    energyClass: energyClass(specific),
    elements,
    zones: [...zoneLoss.entries()].map(([zoneId, v]) => ({ zoneId, ...v })),
  };
}

function emptyEnvelope(storeyId: string): StoreyEnvelope {
  const bucket = () => ({ wall: 0, window: 0, ratio: 0 });
  return {
    storeyId,
    wallGrossArea: 0,
    wallNetArea: 0,
    windowArea: 0,
    doorArea: 0,
    floorArea: 0,
    roofArea: 0,
    windowToWall: { N: bucket(), E: bucket(), S: bucket(), W: bucket() },
    heatedFloorArea: 0,
    heatedVolume: 0,
  };
}

/**
 * The roof as the thermal envelope sees it: built without the overhang, since the
 * eave strip hangs outside the heated volume. Used by the energy balance and the
 * room heat loads so both agree.
 */
export function thermalRoof(building: Building): RoofGeometry {
  return buildRoof({ ...building, roof: { ...roofOf(building), overhang: 0 } }, 0);
}

/** Sloped roof area per square metre of plan, 1 for a flat roof. */
export function roofSlopeFactor(building: Building, roof = thermalRoof(building)): number {
  const plan = area(building.footprint);
  return plan > 0 ? roof.area / plan : 1;
}

/**
 * The interior walls of a storey as the room graph sees them: clipped to the
 * footprint, split where they cross each other or meet the footprint, and without
 * the pieces lying on the footprint boundary. Every piece borders exactly two rooms
 * (or one room twice when it dangles), so per-piece midpoint tests are exact.
 */
export function interiorWallPieces(
  footprint: readonly Vec2[],
  interiorWalls: readonly Segment[],
): Segment[] {
  const n = footprint.length;
  const boundary: Segment[] = footprint.map((p, i) => ({ a: p, b: footprint[(i + 1) % n] ?? p }));
  const clipped = interiorWalls.flatMap((w) => clipSegmentToPolygon(w, footprint));
  const onBoundary = (p: Vec2) => boundary.some((e) => pointOnSegment(p, e.a, e.b, 1e-6));
  return splitSegments([...boundary, ...clipped]).filter(
    (piece) => !onBoundary({ x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 }),
  );
}

/** The two rooms on either side of an interior wall's midpoint, or null on the boundary. */
export function roomsAround(
  wall: { a: Vec2; b: Vec2 },
  rooms: readonly Room[],
): [Room, Room] | null {
  const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  const d = sub(wall.b, wall.a);
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-9) return null;
  const n = { x: -d.y / len, y: d.x / len };
  const eps = 0.01;
  const left = rooms.find((r) =>
    pointInPolygon({ x: mid.x + n.x * eps, y: mid.y + n.y * eps }, r.polygon),
  );
  const right = rooms.find((r) =>
    pointInPolygon({ x: mid.x - n.x * eps, y: mid.y - n.y * eps }, r.polygon),
  );
  if (!left || !right || left === right) return null;
  return [left, right];
}

/** Zone of the room behind an opening (the room touching the wall at the opening centre). */
function zoneForOpening(
  o: Opening,
  edge: Edge,
  storey: Storey,
  zones: readonly Zone[],
): string | null {
  const u = o.offset + o.width / 2;
  const p = {
    x: edge.a.x + edge.direction.x * u - edge.normal.x * 0.01,
    y: edge.a.y + edge.direction.y * u - edge.normal.y * 0.01,
  };
  const room = storey.rooms.find((r) => pointInPolygon(p, r.polygon));
  if (!room || !isRoomHeated(room, zones)) return null;
  return room.zoneId ?? null;
}

function distributeWallLoss(
  edge: Edge,
  storey: Storey,
  zones: readonly Zone[],
  loss: number,
  addZone: (zoneId: string | null, floorArea: number, loss: number) => void,
) {
  if (storey.rooms.length === 0) {
    addZone(null, 0, loss);
    return;
  }
  const perRoom: { zoneId: string | null; length: number }[] = [];
  let total = 0;
  for (const room of storey.rooms) {
    if (!isRoomHeated(room, zones)) continue;
    const spans = heatedSpans(edge, [room], zones);
    const l = spanLength(spans);
    if (l <= 0) continue;
    perRoom.push({ zoneId: room.zoneId ?? null, length: l });
    total += l;
  }
  if (total <= 0) {
    addZone(null, 0, loss);
    return;
  }
  for (const r of perRoom) addZone(r.zoneId, 0, (loss * r.length) / total);
}
