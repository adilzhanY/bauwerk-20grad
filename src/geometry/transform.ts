import { centroid } from "./polygon";
import type { Building, Vec2 } from "./types";

/**
 * Moving the whole building on the plan. Everything stored in plan
 * coordinates moves: footprint, interior walls, room polygons, heat pumps. Openings
 * and radiators are offsets along their wall and follow it unchanged. The geo
 * origin stays where it is, so the map under the building does not move and the
 * building's position on the earth is read from its centre.
 */

const round = (v: number) => Math.round(v * 1e6) / 1e6;

const translatePoint = (p: Vec2, d: Vec2): Vec2 => ({
  x: round(p.x + d.x),
  y: round(p.y + d.y),
});

function mapBuilding(b: Building, f: (p: Vec2) => Vec2): Building {
  return {
    ...b,
    footprint: b.footprint.map(f),
    storeys: b.storeys.map((s) => ({
      ...s,
      interiorWalls: s.interiorWalls.map((w) => ({ ...w, a: f(w.a), b: f(w.b) })),
      rooms: s.rooms.map((r) => ({ ...r, polygon: r.polygon.map(f) })),
      pipes: s.pipes?.map((pipe) => ({ ...pipe, points: pipe.points.map(f) })),
      measurements: s.measurements?.map((m) => ({ ...m, a: f(m.a), b: f(m.b) })),
    })),
    heatPumps: b.heatPumps?.map((h) => ({ ...h, position: f(h.position) })),
  };
}

export function translateBuilding(b: Building, delta: Vec2): Building {
  if (delta.x === 0 && delta.y === 0) return b;
  return mapBuilding(b, (p) => translatePoint(p, delta));
}

export const buildingCentre = (b: Building): Vec2 => centroid(b.footprint);
