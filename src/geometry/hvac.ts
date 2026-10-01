import { sharedEdgeSet } from "./shared";
import {
  AIR_HEAT_CAPACITY,
  FX_GROUND_FLOOR,
  FX_TOP_CEILING,
  FX_UNHEATED_BELOW,
  FX_UNHEATED_ROOM,
  computeEnergy,
  interiorWallPieces,
  isRoomHeated,
  roofEnvelope,
  roomArea,
  roomsAround,
  unheatedShare,
} from "./energy";
import { findConstruction, interiorWallType } from "./constructions";
import { countedOpenings, openingsOn } from "./openings";
import { distance, edges, pointInPolygon, spansOnEdge } from "./polygon";
import type { Building, Radiator, Room, Storey } from "./types";
import type { EnergySummary } from "./energy";

/** Air change for the heat load, 1/h: the DIN EN 12831 minimum for living rooms. */
export const HEAT_LOAD_AIR_CHANGE = 0.5;

/**
 * Heat load and equipment sizing, simplified after DIN EN 12831:
 *   Φ_room = (Σ F_x · U·A over the room's exterior surfaces + 0.34 · n · V) · (θ_in − θ_e)
 * with θ_in from the zone (20 °C heated) and θ_e = −14 °C, the design outdoor
 * temperature for Berlin in DIN EN 12831 Beiblatt 1. The floor slab counts with
 * F_x = 0.6 and walls to unheated rooms with 0.5, a floor over an unheated storey with 0.6 and a
 * ceiling under one with 0.8, as in the energy balance.
 * V is the room's share of the storey's heated volume by floor area, so a heated
 * attic on the top storey is spread over its rooms and the room loads sum to the
 * building load. Thermal bridges are spread onto the room by floor area share. Radiators are
 * sized to the room load rounded up to 100 W; the heat pump to the building load
 * with a 1.1 safety factor.
 */

export const DESIGN_OUTDOOR_TEMPERATURE = -14;

export interface RoomHeatLoad {
  roomId: string;
  storeyId: string;
  name: string;
  /** Watts. */
  load: number;
  /** Installed radiator power in watts. */
  installed: number;
  /** installed / load, 1 means covered. */
  coverage: number;
}

/** U·A of a room's share of the exterior envelope, in W/K. */
export function roomEnvelopeLoss(building: Building, storey: Storey, room: Room): number {
  const fp = building.footprint;
  const es = edges(fp);
  const u = (id: string, fallback = 0) =>
    findConstruction(building.constructions, id)?.uValue ?? fallback;
  const wallU = u(building.wallConstructionId);
  const shared = sharedEdgeSet(building);
  let loss = 0;
  for (const e of es) {
    // A party wall against a heated neighbour loses no heat.
    if (shared.has(e.index)) continue;
    // Spans of this room's polygon lying on the footprint edge.
    const spans = spansOnEdge(room.polygon, e);
    if (spans.length === 0) continue;
    const length = spans.reduce((s, [x0, x1]) => s + (x1 - x0), 0);
    let openingArea = 0;
    for (const o of countedOpenings(
      openingsOn(storey.openings, e.index),
      e.length,
      storey.height,
    )) {
      const centre = o.offset + o.width / 2;
      if (!spans.some(([x0, x1]) => centre >= x0 - 1e-6 && centre <= x1 + 1e-6)) continue;
      openingArea += o.width * o.height;
      loss += u(o.constructionId) * o.width * o.height;
    }
    loss += wallU * Math.max(0, length * storey.height - openingArea);
  }
  const index = building.storeys.findIndex((s) => s.id === storey.id);
  const floor = roomArea(room);
  if (index === 0) loss += FX_GROUND_FLOOR * u(building.floorConstructionId) * floor;
  // To an unheated storey below (cellar ceiling) or above (top floor ceiling), as in the balance.
  loss +=
    FX_UNHEATED_BELOW *
    u(building.floorConstructionId) *
    floor *
    unheatedShare(building.storeys[index - 1], building.zones);
  loss +=
    FX_TOP_CEILING *
    u(building.roofConstructionId) *
    floor *
    unheatedShare(building.storeys[index + 1], building.zones);
  if (index === building.storeys.length - 1) {
    // Through the roof, or through the top floor ceiling under a cold attic.
    const top = roofEnvelope(building);
    loss += top.fx * u(building.roofConstructionId) * floor * top.factor;
  }
  // Interior wall pieces between this room and an unheated neighbour.
  for (const piece of interiorWallPieces(fp, storey.interiorWalls)) {
    const between = roomsAround(piece, storey.rooms);
    if (!between) continue;
    const other =
      between[0].id === room.id ? between[1] : between[1].id === room.id ? between[0] : null;
    if (!other || isRoomHeated(other, building.zones)) continue;
    const pieceU = interiorWallType(building.constructions, piece).uValue;
    loss += FX_UNHEATED_ROOM * pieceU * distance(piece.a, piece.b) * storey.height;
  }
  return loss;
}

export function roomHeatLoads(building: Building): RoomHeatLoad[] {
  const energy = computeEnergy(building);
  const heatedArea = Math.max(1e-9, energy.heatedFloorArea);
  const out: RoomHeatLoad[] = [];
  for (const storey of building.storeys) {
    const envelope = energy.storeys.find((s) => s.storeyId === storey.id);
    const radiatorPowerByRoom = new Map<string, number>();
    const es = edges(building.footprint);
    for (const rad of storey.radiators ?? []) {
      const e = es[rad.wallIndex];
      if (!e) continue;
      const u = rad.offset + rad.width / 2;
      const p = {
        x: e.a.x + e.direction.x * u - e.normal.x * 0.05,
        y: e.a.y + e.direction.y * u - e.normal.y * 0.05,
      };
      const room = storey.rooms.find((r) => pointInPolygon(p, r.polygon));
      if (room)
        radiatorPowerByRoom.set(room.id, (radiatorPowerByRoom.get(room.id) ?? 0) + rad.power);
    }
    for (const room of storey.rooms) {
      if (!isRoomHeated(room, building.zones)) continue;
      const zone = building.zones.find((z) => z.id === room.zoneId);
      const deltaT = (zone?.temperature ?? 20) - DESIGN_OUTDOOR_TEMPERATURE;
      const transmission = roomEnvelopeLoss(building, storey, room);
      // The room's share of the storey's heated volume, attic included on the top storey.
      const floor = roomArea(room);
      const volume =
        envelope && envelope.heatedFloorArea > 0
          ? envelope.heatedVolume * (floor / envelope.heatedFloorArea)
          : floor * storey.height;
      const ventilation = AIR_HEAT_CAPACITY * HEAT_LOAD_AIR_CHANGE * volume;
      const bridges = energy.bridgeLoss * (floor / heatedArea);
      const load = (transmission + ventilation + bridges) * deltaT;
      const installed = radiatorPowerByRoom.get(room.id) ?? 0;
      out.push({
        roomId: room.id,
        storeyId: storey.id,
        name: room.name,
        load,
        installed,
        coverage: load > 0 ? installed / load : 1,
      });
    }
  }
  return out;
}

/** Radiator size suggestion: the room load rounded up to 100 W, at least 300 W. */
export const suggestRadiatorPower = (load: number): number =>
  Math.max(300, Math.ceil(load / 100) * 100);

/** Heat pump suggestion in kW: the building load with a 1.1 safety factor, rounded to 0.5 kW. */
export function suggestHeatPumpPower(building: Building): number {
  const total = roomHeatLoads(building).reduce((s, r) => s + r.load, 0);
  return Math.max(2, Math.ceil((total * 1.1) / 500) / 2);
}

/** A radiator stays on its wall and never overlaps an opening or another radiator. */
export function validateRadiator(rad: Radiator, storey: Storey, wallLength: number): boolean {
  if (rad.offset < -1e-9 || rad.offset + rad.width > wallLength + 1e-9) return false;
  if (rad.width < 0.2 || rad.height < 0.2 || rad.height > storey.height || rad.power <= 0)
    return false;
  const end = rad.offset + rad.width;
  for (const o of storey.openings) {
    if (o.interior || o.wallIndex !== rad.wallIndex) continue;
    // Below a window is fine; a door or a window reaching the floor is not.
    const reachesRadiator = o.sill < rad.height + 0.1;
    if (reachesRadiator && rad.offset < o.offset + o.width - 1e-6 && o.offset < end - 1e-6)
      return false;
  }
  for (const other of storey.radiators ?? []) {
    if (other.id === rad.id || other.wallIndex !== rad.wallIndex) continue;
    if (rad.offset < other.offset + other.width - 1e-6 && other.offset < end - 1e-6) return false;
  }
  return true;
}

export const DEFAULT_RADIATOR = { width: 1.0, height: 0.6, power: 1000 };

/**
 * Design heat load of the whole building in watts, DIN EN 12831 in its simplest form: the
 * transmission and ventilation loss coefficients times the design temperature difference,
 * 20 °C inside against the Berlin design outdoor temperature. Works without drawn rooms.
 */
export function buildingHeatLoad(
  energy: Pick<EnergySummary, "transmissionLoss" | "ventilationLoss">,
): number {
  return (energy.transmissionLoss + energy.ventilationLoss) * (20 - DESIGN_OUTDOOR_TEMPERATURE);
}

/**
 * Heat pump readiness, the flow temperature test energy consultants do before recommending a
 * heat pump. A radiator's output falls with the water temperature by EN 442:
 *   Φ / Φ_rated = (ΔT_ln / ΔT_ln,rated)^n,  ΔT_ln = (θ_flow − θ_return) / ln((θ_flow − θ_room) / (θ_return − θ_room))
 * with n = 1.3 and the rating at 75/65/20 °C, the design values radiators are sold with. A
 * room is ready when its radiators still cover its heat load at the flow temperature a heat
 * pump runs efficiently with, 55 °C, return 10 K lower.
 */
export const RADIATOR_EXPONENT = 1.3;
export const RATED_FLOW = 75;
export const RATED_RETURN = 65;
export const RATED_ROOM = 20;
/** Flow temperature up to which a heat pump runs efficiently in an existing building. */
export const HEAT_PUMP_FLOW = 55;
/** Flow minus return, K. */
export const FLOW_SPREAD = 10;
const MAX_FLOW = 90;

const lmtd = (flow: number, back: number, room: number) =>
  (flow - back) / Math.log((flow - room) / (back - room));

/** Share of its rated output a radiator gives at `flow` (return 10 K lower) in a room at `room` °C. */
export function radiatorOutputFactor(flow: number, room = RATED_ROOM): number {
  const back = flow - FLOW_SPREAD;
  if (back <= room + 1e-6) return 0;
  const rated = lmtd(RATED_FLOW, RATED_RETURN, RATED_ROOM);
  return (lmtd(flow, back, room) / rated) ** RADIATOR_EXPONENT;
}

/**
 * The lowest flow temperature at which radiators rated `installed` watts cover `load` watts
 * in a room at `room` °C, to a tenth of a degree. Null when nothing is installed or even
 * 90 °C is not enough.
 */
export function requiredFlowTemperature(
  load: number,
  installed: number,
  room = RATED_ROOM,
): number | null {
  if (installed <= 0) return null;
  if (load <= 0) return room + FLOW_SPREAD;
  if (installed * radiatorOutputFactor(MAX_FLOW, room) < load) return null;
  let low = room + FLOW_SPREAD;
  let high = MAX_FLOW;
  while (high - low > 0.05) {
    const mid = (low + high) / 2;
    if (installed * radiatorOutputFactor(mid, room) >= load) high = mid;
    else low = mid;
  }
  return Math.ceil(high * 10) / 10;
}

export interface RoomReadiness {
  roomId: string;
  name: string;
  load: number;
  installed: number;
  /** Flow temperature this room needs; null without radiators or when 90 °C is not enough. */
  flow: number | null;
  /** Rated radiator power the room would need to be covered at 55 °C. */
  neededRated: number;
}

export interface HeatPumpReadiness {
  /** Heated rooms that have radiators; the others cannot be judged. */
  rooms: RoomReadiness[];
  /** Heated rooms without a radiator. */
  withoutRadiator: number;
  /** The flow temperature the building needs: the highest of its rooms. Null when unknown. */
  flow: number | null;
  /** Rooms covered at 55 °C. */
  ready: number;
}

export function heatPumpReadiness(building: Building): HeatPumpReadiness {
  const loads = roomHeatLoads(building);
  const roomTemperature = (roomId: string) => {
    const room = building.storeys.flatMap((s) => s.rooms).find((r) => r.id === roomId);
    return building.zones.find((z) => z.id === room?.zoneId)?.temperature ?? RATED_ROOM;
  };
  const rooms: RoomReadiness[] = loads
    .filter((l) => l.installed > 0)
    .map((l) => {
      const room = roomTemperature(l.roomId);
      const factor = radiatorOutputFactor(HEAT_PUMP_FLOW, room);
      return {
        roomId: l.roomId,
        name: l.name,
        load: l.load,
        installed: l.installed,
        flow: requiredFlowTemperature(l.load, l.installed, room),
        neededRated: factor > 0 ? l.load / factor : Infinity,
      };
    });
  const flows = rooms.map((r) => r.flow);
  return {
    rooms,
    withoutRadiator: loads.length - rooms.length,
    flow:
      rooms.length === 0 || flows.some((f) => f === null) ? null : Math.max(...(flows as number[])),
    ready: rooms.filter((r) => r.flow !== null && r.flow <= HEAT_PUMP_FLOW).length,
  };
}
