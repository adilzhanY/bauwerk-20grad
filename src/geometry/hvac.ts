import { sharedEdgeSet } from "./shared";
import {
  AIR_CHANGE_RATE,
  AIR_HEAT_CAPACITY,
  FX_GROUND_FLOOR,
  FX_UNHEATED_ROOM,
  INTERIOR_WALL_U,
  computeEnergy,
  interiorWallPieces,
  isRoomHeated,
  roofSlopeFactor,
  roomsAround,
} from "./energy";
import { findConstruction } from "./constructions";
import { openingsOn, validateOpening } from "./openings";
import { distance, edges, pointInPolygon, pointOnSegment } from "./polygon";
import type { Building, Radiator, Room, Storey } from "./types";
import type { EnergySummary } from "./energy";

/**
 * Heat load and equipment sizing, simplified after DIN EN 12831:
 *   Φ_room = (Σ F_x · U·A over the room's exterior surfaces + 0.34 · n · V) · (θ_in − θ_e)
 * with θ_in from the zone (20 °C heated) and θ_e = −14 °C, the design outdoor
 * temperature for Berlin in DIN EN 12831 Beiblatt 1. The floor slab counts with
 * F_x = 0.6 and walls to unheated rooms with 0.5, as in the energy balance.
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
    const spans: [number, number][] = [];
    const n = room.polygon.length;
    for (let i = 0; i < n; i++) {
      const a = room.polygon[i];
      const b = room.polygon[(i + 1) % n];
      if (!a || !b) continue;
      if (pointOnSegment(a, e.a, e.b) && pointOnSegment(b, e.a, e.b)) {
        const ua = distance(a, e.a);
        const ub = distance(b, e.a);
        spans.push([Math.min(ua, ub), Math.max(ua, ub)]);
      }
    }
    if (spans.length === 0) continue;
    const length = spans.reduce((s, [x0, x1]) => s + (x1 - x0), 0);
    const onWall = openingsOn(storey.openings, e.index);
    let openingArea = 0;
    for (const o of onWall) {
      if (
        validateOpening(o, { wallLength: e.length, storeyHeight: storey.height, siblings: onWall })
          .length > 0
      )
        continue;
      const centre = o.offset + o.width / 2;
      if (!spans.some(([x0, x1]) => centre >= x0 - 1e-6 && centre <= x1 + 1e-6)) continue;
      openingArea += o.width * o.height;
      loss += u(o.constructionId) * o.width * o.height;
    }
    loss += wallU * Math.max(0, length * storey.height - openingArea);
  }
  const index = building.storeys.findIndex((s) => s.id === storey.id);
  if (index === 0) loss += FX_GROUND_FLOOR * u(building.floorConstructionId) * room.area;
  if (index === building.storeys.length - 1)
    loss += u(building.roofConstructionId) * room.area * roofSlopeFactor(building);
  // Interior wall pieces between this room and an unheated neighbour.
  for (const piece of interiorWallPieces(fp, storey.interiorWalls)) {
    const between = roomsAround(piece, storey.rooms);
    if (!between) continue;
    const other =
      between[0].id === room.id ? between[1] : between[1].id === room.id ? between[0] : null;
    if (!other || isRoomHeated(other, building.zones)) continue;
    loss += FX_UNHEATED_ROOM * INTERIOR_WALL_U * distance(piece.a, piece.b) * storey.height;
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
      const volume =
        envelope && envelope.heatedFloorArea > 0
          ? envelope.heatedVolume * (room.area / envelope.heatedFloorArea)
          : room.area * storey.height;
      const ventilation = AIR_HEAT_CAPACITY * AIR_CHANGE_RATE * volume;
      const bridges = energy.bridgeLoss * (room.area / heatedArea);
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
