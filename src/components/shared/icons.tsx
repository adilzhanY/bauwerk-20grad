import { createLucideIcon } from "lucide-react";

/**
 * Icons lucide has no good match for, drawn on lucide's own grid: 24 px, a 2 px round stroke,
 * round joins, kept 2 px off the edge. createLucideIcon makes each one take size, className and
 * strokeWidth exactly like a lucide icon, so a call site only changes its import.
 */

/** The outline tool: a closed plan outline with corner handles. */
export const Footprint = createLucideIcon("Footprint", [
  ["path", { d: "M7 4h6v7h7v6", key: "footprint-0" }],
  ["path", { d: "M17 20H6a2 2 0 0 1-2-2V7", key: "footprint-1" }],
  ["rect", { x: "2", y: "2", width: "4", height: "4", rx: "1", key: "footprint-2" }],
  ["rect", { x: "18", y: "18", width: "4", height: "4", rx: "1", key: "footprint-3" }],
]);

/** A window: a frame with mullions on a sill. */
export const WindowFrame = createLucideIcon("WindowFrame", [
  ["rect", { x: "5", y: "3", width: "14", height: "15", rx: "2", key: "windowframe-0" }],
  ["path", { d: "M12 3v15", key: "windowframe-1" }],
  ["path", { d: "M5 10h14", key: "windowframe-2" }],
  ["path", { d: "M3 21h18", key: "windowframe-3" }],
]);

/** An exterior wall: masonry hatching, as in a German plan. */
export const WallHatched = createLucideIcon("WallHatched", [
  ["rect", { x: "3", y: "7", width: "18", height: "10", rx: "2", key: "wallhatched-0" }],
  ["path", { d: "m7 17 6-10", key: "wallhatched-1" }],
  ["path", { d: "m13 17 6-10", key: "wallhatched-2" }],
]);

/** An interior wall dividing a room. */
export const InteriorWall = createLucideIcon("InteriorWall", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", key: "interiorwall-0" }],
  ["path", { d: "M12 3v6", key: "interiorwall-1" }],
  ["path", { d: "M12 14v7", key: "interiorwall-2" }],
]);

/** A zone: part of the plan hatched. */
export const Zone = createLucideIcon("Zone", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", key: "zone-0" }],
  ["path", { d: "M12 3v18", key: "zone-1" }],
  ["path", { d: "M3 12l9-9", key: "zone-2" }],
  ["path", { d: "M4 20l8-8", key: "zone-3" }],
]);

/** A radiator with its fins and feet. */
export const Radiator = createLucideIcon("Radiator", [
  ["rect", { x: "3", y: "5", width: "18", height: "13", rx: "2", key: "radiator-0" }],
  ["path", { d: "M7.5 5v13", key: "radiator-1" }],
  ["path", { d: "M12 5v13", key: "radiator-2" }],
  ["path", { d: "M16.5 5v13", key: "radiator-3" }],
  ["path", { d: "M6 18v2", key: "radiator-4" }],
  ["path", { d: "M18 18v2", key: "radiator-5" }],
]);

/** An air source heat pump outdoor unit: fan and grille. */
export const HeatPump = createLucideIcon("HeatPump", [
  ["rect", { x: "2", y: "5", width: "20", height: "14", rx: "2", key: "heatpump-0" }],
  ["circle", { cx: "9", cy: "12", r: "4", key: "heatpump-1" }],
  ["path", { d: "M9 12h.01", key: "heatpump-2" }],
  ["path", { d: "M16 9h3", key: "heatpump-3" }],
  ["path", { d: "M16 12h3", key: "heatpump-4" }],
  ["path", { d: "M16 15h3", key: "heatpump-5" }],
]);

/** A pitched roof over the top slab. */
export const Roof = createLucideIcon("Roof", [
  ["path", { d: "m2 13 10-9 10 9", key: "roof-0" }],
  ["path", { d: "M5 13h14", key: "roof-1" }],
]);

/** A storey between two slabs. */
export const Storey = createLucideIcon("Storey", [
  ["path", { d: "M2 5h20", key: "storey-0" }],
  ["path", { d: "M2 19h20", key: "storey-1" }],
  ["path", { d: "M6 5v14", key: "storey-2" }],
  ["path", { d: "M18 5v14", key: "storey-3" }],
  ["rect", { x: "9", y: "9", width: "6", height: "5", rx: "1", key: "storey-4" }],
]);

/** A floor plan: rooms divided by walls with door gaps. */
export const FloorPlan = createLucideIcon("FloorPlan", [
  ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", key: "floorplan-0" }],
  ["path", { d: "M11 3v6", key: "floorplan-1" }],
  ["path", { d: "M3 13h4", key: "floorplan-2" }],
  ["path", { d: "M11 13h10", key: "floorplan-3" }],
  ["path", { d: "M15 13v8", key: "floorplan-4" }],
]);
