import { endEnergyOf, heatingOf } from "./heating";
import { bridgeDetailOf, emptyBridgeSummary, summarizeBridges } from "./bridges";
import { sharedEdgeSet } from "./shared";
import type { BridgeSummary } from "./bridges";
import { findConstruction, interiorWallType } from "./constructions";
import { buildRoof, roofOf } from "./roof";
import type { RoofGeometry } from "./roof";
import { clipSegmentToPolygon, splitSegments } from "./rooms";
import { GAIN_UTILISATION, GLAZING_G, solarGains } from "./sun";
import { countedOpenings, openingsOn } from "./openings";
import { windowType } from "./windows";
import { area, edges, pointInPolygon, pointOnSegment, sub, distance } from "./polygon";
import type { Edge } from "./polygon";
import type {
  Building,
  Construction,
  ConstructionCategory,
  InteriorWall,
  Opening,
  Room,
  Segment,
  Storey,
  Vec2,
  Zone,
} from "./types";

/**
 * Building physics after the heating period method of DIN V 4108-6 Annex D, the
 * simplified procedure the EnEV allowed for residential buildings, with the reference
 * area, ventilation and thermal bridges as a certificate for the existing stock counts them.
 *
 * Heated gross volume                  V_e  = Σ heated floor (outer dimensions) · storey height
 * Reference area (Gebäudenutzfläche)   A_N  = 0.32 · V_e, or (1/h_G − 0.04) · V_e when the
 *                                             mean storey height h_G is outside 2.5 to 3.0 m
 * Transmission heat loss coefficient   H_T  = Σ F_x,i · U_i · A_i + H_WB                [W/K]
 * Thermal bridges                      H_WB = ΔU_WB · A (flat, 0.10 by default) or Σ ψ·l
 * Ventilation heat loss coefficient    H_V  = 0.34 · n · V, n = 0.7 1/h without an airtightness
 *                                             test, V = 0.76 · V_e up to three storeys, else 0.8
 * Specific transmission loss           H_T' = H_T / A_envelope                    [W/(m²K)]
 * Annual heating demand                Q_h  = 66 kKh · (H_T + H_V) − 0.95 · (Q_s + Q_i)   [kWh/a]
 * Internal gains                       Q_i  = 22 kWh/(m²a) · A_N
 * Specific values                      per m² of A_N, as the Energieausweis states them
 *
 * F_x is the temperature correction factor of DIN V 4108-6 table 3: 1.0 to outside air, 0.8
 * for the top floor ceiling under a cold attic, 0.6 for the floor on the ground, 0.5 for walls
 * to unheated rooms. Solar gains come from ./sun.ts with each window's own g-value, detailed
 * thermal bridges from ./bridges.ts. Interior walls between a heated and an unheated room count
 * with their own type's U-value. Rooms without a zone count as heated, a storey without rooms
 * as fully heated. Room areas are taken from their outlines, never from a stored number. The
 * reference climate is the German one; the orientation of the windows follows the site's
 * rotation. An opening dropped over another counts only once it is moved clear.
 */

export const AIR_HEAT_CAPACITY = 0.34; // Wh/(m³K)
/** Air change rate of an existing building without an airtightness test, 1/h. */
export const AIR_CHANGE_RATE = 0.7;
/** Net air volume per heated gross volume, up to three storeys and above. */
export const AIR_VOLUME_LOW = 0.76;
export const AIR_VOLUME_HIGH = 0.8;
/** Heating degree hours of the German reference climate, DIN V 4108-6 Annex D. */
export const HEATING_DEGREE_HOURS = 66; // kKh per year
/** Internal gains per square metre of reference area over the heating period. */
export const INTERNAL_GAINS_PER_M2 = 22; // kWh/(m²a)
/** Temperature correction factors F_x, DIN V 4108-6 table 3. */
export const FX_GROUND_FLOOR = 0.6;
export const FX_TOP_CEILING = 0.8;
export const FX_UNHEATED_ROOM = 0.5;
/** Flat thermal bridge surcharge ΔU_WB, W/(m²K): without and with good detailing. */
export const BRIDGE_SURCHARGE = 0.1;
export const BRIDGE_SURCHARGE_GOOD = 0.05;

/** A_N from the heated gross volume and the mean storey height (EnEV Anlage 1, 1.3.3). */
export function referenceAreaOf(grossVolume: number, meanStoreyHeight: number): number {
  if (grossVolume <= 0) return 0;
  if (meanStoreyHeight >= 2.5 && meanStoreyHeight <= 3.0) return 0.32 * grossVolume;
  return Math.max(0, 1 / meanStoreyHeight - 0.04) * grossVolume;
}

/** ΔU_WB the building is counted with under the flat method. */
export function bridgeSurchargeOf(building: Building): number {
  return (
    building.bridgeSurcharge ??
    (building.bridgeDetail === "good" ? BRIDGE_SURCHARGE_GOOD : BRIDGE_SURCHARGE)
  );
}

export type Orientation = "N" | "E" | "S" | "W";

export interface ElementLoss {
  category: ConstructionCategory | "interiorWall" | "bridge";
  /** Set for a roof that is really the top floor ceiling under a cold attic. */
  ceiling?: boolean;
  /** Temperature correction factor F_x, 1 when missing. */
  fx?: number;
  label: string;
  area: number;
  uValue: number;
  /** U · A in W/K, the temperature correction factor included. */
  loss: number;
  /** Compass bearing the element faces, degrees from north, for walls and openings. */
  azimuth?: number;
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
  /** Metres. */
  storeyHeight: number;
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
  /** Heated floor area on outer dimensions, the gross area of the heated rooms. */
  heatedFloorArea: number;
  /** Heated gross volume V_e, m³. */
  heatedVolume: number;
  /** Gebäudenutzfläche A_N, m²: what every per m² value is divided by. */
  referenceArea: number;
  /** "flat" (ΔU_WB over the envelope) or "detailed" (ψ·l). */
  bridgeMethod: "flat" | "detailed";
  /** Σ U·A plus the thermal bridge term. */
  transmissionLoss: number;
  /** H_WB, already included in transmissionLoss. */
  bridgeLoss: number;
  /** The ψ·l bridges, filled only with the detailed method. */
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
  /**
   * End energy per m² A_N and year: heating, hot water and auxiliary electricity through the
   * building's heating system (heating.ts). The Energieausweis class is read off this.
   */
  specificEndEnergy: number;
  /** False when no room is heated; the demand is then zero and the class is not meaningful. */
  heated: boolean;
  /** Energieausweis class, from the end energy. */
  energyClass: EnergyClass;
  elements: ElementLoss[];
  /** Per zone: heated floor area (gross) and transmission loss through its envelope. */
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

/** Compass bearing a plan normal points to, degrees clockwise from north, 0 to 360. */
export function azimuthOf(normal: Vec2, rotationDegrees = 0): number {
  const angle = (Math.atan2(normal.x, normal.y) * 180) / Math.PI + rotationDegrees;
  return ((angle % 360) + 360) % 360;
}

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
  /** Rotation of the plan's +y axis from north, degrees, from geo placement. */
  rotationDegrees?: number;
}

export function computeEnergy(building: Building, options: EnergyOptions = {}): EnergySummary {
  const all = building.constructions;
  const pick = (id: string): Construction | undefined => findConstruction(all, id);
  const wallU = uOf(pick(building.wallConstructionId));
  const floorU = uOf(pick(building.floorConstructionId));
  const roofU = uOf(pick(building.roofConstructionId));

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
  // Window area times g, per orientation: what the sun works through.
  const heatedWindowsByOrientation: Record<Orientation, number> = { N: 0, E: 0, S: 0, W: 0 };

  building.storeys.forEach((storey, storeyIndex) => {
    const env = emptyEnvelope(storey.id, storey.height);
    const heatedRooms = storey.rooms.filter((r) => isRoomHeated(r, building.zones));
    env.heatedFloorArea =
      storey.rooms.length === 0 ? footprintArea : heatedRooms.reduce((s, r) => s + roomArea(r), 0);
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
      const valid = countedOpenings(
        openingsOn(storey.openings, edge.index),
        edge.length,
        storey.height,
      );
      const rotation = options.rotationDegrees ?? building.origin?.rotation ?? 0;
      const orientation = orientationOf(edge.normal, rotation);
      const azimuth = azimuthOf(edge.normal, rotation);
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
        const construction = pick(o.constructionId);
        if (o.kind === "window") heatedWindowsByOrientation[orientation] += a * gOf(construction);
        const u = uOf(construction);
        transmission += u * a;
        elements.push({
          category: o.kind,
          label: `${storey.name} / ${orientation}`,
          area: a,
          uValue: u,
          loss: u * a,
          azimuth,
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
          azimuth,
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
          fx: FX_GROUND_FLOOR,
          label: storey.name,
          area: heated,
          uValue: floorU,
          loss: floorLoss,
        });
      for (const r of heatedRooms)
        addZone(r.zoneId ?? null, roomArea(r), FX_GROUND_FLOOR * floorU * roomArea(r));
    } else {
      for (const r of heatedRooms) addZone(r.zoneId ?? null, roomArea(r), 0);
    }
    if (storeyIndex === building.storeys.length - 1) {
      // Under a heated attic or a flat roof the roof itself is the envelope, on its true
      // sloped area (the overhang is outside it). Under a cold attic the heat leaves through
      // the top floor ceiling, on the plan area, and the attic shields it: F_x 0.8.
      const roofGeo = thermalRoof(building);
      const { through, fx, factor } = roofEnvelope(building, roofGeo);
      env.roofArea = roofGeo.area;
      const heatedPlan = env.heatedFloorArea;
      const heated = heatedPlan * factor;
      const roofLoss = fx * roofU * heated;
      transmission += roofLoss;
      if (heated > 0) {
        elements.push({
          category: "roof",
          ...(through === "ceiling" ? { ceiling: true, fx } : {}),
          label: storey.name,
          area: heated,
          uValue: roofU,
          loss: roofLoss,
        });
      }
      for (const r of heatedRooms) addZone(r.zoneId ?? null, 0, fx * roofU * roomArea(r) * factor);
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
      // Its own type's U-value: a brick partition loses far more than an insulated drywall.
      const u = interiorWallType(all, wall).uValue;
      const loss = FX_UNHEATED_ROOM * u * a;
      transmission += loss;
      elements.push({
        category: "interiorWall",
        fx: FX_UNHEATED_ROOM,
        label: storey.name,
        area: a,
        uValue: u,
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
  // Thermal bridges. Nothing heated means no temperature difference across them.
  const bridgeMethod = building.bridgeMethod ?? "flat";
  const bridges =
    heated && bridgeMethod === "detailed"
      ? summarizeBridges(building, bridgeDetailOf(building))
      : emptyBridgeSummary();
  const bridgeLoss = !heated
    ? 0
    : bridgeMethod === "detailed"
      ? bridges.total
      : bridgeSurchargeOf(building) * envelopeArea;
  if (bridgeLoss > 0) {
    transmission += bridgeLoss;
    elements.push({
      category: "bridge",
      label: "bridges",
      area: 0,
      uValue: bridgeMethod === "flat" ? bridgeSurchargeOf(building) : 0,
      loss: bridgeLoss,
    });
  }
  const meanHeight = heatedFloorArea > 0 ? grossHeatedStoreyVolume(storeys) / heatedFloorArea : 0;
  const referenceArea = referenceAreaOf(heatedVolume, meanHeight);
  const airVolume =
    (building.storeys.length <= 3 ? AIR_VOLUME_LOW : AIR_VOLUME_HIGH) * heatedVolume;
  const ventilation = AIR_HEAT_CAPACITY * AIR_CHANGE_RATE * airVolume;
  const gains = solarGains(heatedWindowsByOrientation);
  const internalGains = GAIN_UTILISATION * INTERNAL_GAINS_PER_M2 * referenceArea;
  const heatingDemand = heated
    ? Math.max(0, (transmission + ventilation) * HEATING_DEGREE_HOURS - gains - internalGains)
    : 0;
  const specific = referenceArea > 0 ? heatingDemand / referenceArea : 0;
  const specificEnd =
    heated && referenceArea > 0
      ? endEnergyOf(heatingOf(building), heatingDemand, referenceArea).total / referenceArea
      : 0;

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
    referenceArea,
    bridgeMethod,
    transmissionLoss: transmission,
    bridgeLoss,
    bridges,
    specificTransmissionLoss: envelopeArea > 0 ? transmission / envelopeArea : 0,
    ventilationLoss: ventilation,
    solarGains: gains,
    internalGains,
    heatingDemand,
    specificHeatingDemand: specific,
    specificEndEnergy: specificEnd,
    heated,
    energyClass: energyClass(specificEnd),
    elements,
    zones: [...zoneLoss.entries()].map(([zoneId, v]) => ({ zoneId, ...v })),
  };
}

/** The heated storeys' floor times height, without an attic: for the mean storey height. */
function grossHeatedStoreyVolume(storeys: readonly StoreyEnvelope[]): number {
  return storeys.reduce((s, e) => s + e.heatedFloorArea * e.storeyHeight, 0);
}

/** A room's floor area, from its outline: a stored number may be stale. */
export const roomArea = (room: Room): number => area(room.polygon);

/** The g-value of a window's glazing: its own, its type's, or double glazing's. */
export function gOf(construction: Construction | undefined): number {
  return construction?.gValue ?? windowType(construction?.id ?? "")?.g ?? GLAZING_G;
}

/**
 * Where the heat leaves at the top: through the roof (flat, or a heated attic), on the sloped
 * area per m² of plan, or through the top floor ceiling under a cold attic, on the plan area.
 */
export function roofEnvelope(
  building: Building,
  roof = thermalRoof(building),
): { through: "roof" | "ceiling"; fx: number; factor: number } {
  const r = roofOf(building);
  if (r.kind === "flat" || r.heatedAttic)
    return { through: "roof", fx: 1, factor: roofSlopeFactor(building, roof) };
  return { through: "ceiling", fx: FX_TOP_CEILING, factor: 1 };
}

function emptyEnvelope(storeyId: string, storeyHeight: number): StoreyEnvelope {
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
    storeyHeight,
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
 * (or one room twice when it dangles), so per-piece midpoint tests are exact. Each piece
 * keeps the type of the wall it is part of.
 */
export function interiorWallPieces(
  footprint: readonly Vec2[],
  interiorWalls: readonly InteriorWall[],
): InteriorWall[] {
  const n = footprint.length;
  const boundary: Segment[] = footprint.map((p, i) => ({ a: p, b: footprint[(i + 1) % n] ?? p }));
  const clipped = interiorWalls.flatMap((w) => clipSegmentToPolygon(w, footprint));
  const onBoundary = (p: Vec2) => boundary.some((e) => pointOnSegment(p, e.a, e.b, 1e-6));
  return splitSegments([...boundary, ...clipped]).flatMap((piece) => {
    const mid = { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 };
    if (onBoundary(mid)) return [];
    const from = interiorWalls.find((w) => pointOnSegment(mid, w.a, w.b, 1e-6));
    return [
      from?.constructionId === undefined
        ? piece
        : { ...piece, constructionId: from.constructionId },
    ];
  });
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
