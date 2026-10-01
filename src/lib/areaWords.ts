import type { AreaElement, Direction } from "@/geometry/areaList";
import type { MessageKey } from "@/i18n";

/** The words of the area list, shared by the panel, its CSV and the print. */
export const ELEMENT_KEYS: Record<AreaElement, MessageKey> = {
  wall: "areas.wall",
  window: "areas.window",
  door: "areas.door",
  roof: "areas.roof",
  floor: "areas.floor",
  interiorWall: "areas.interiorWall",
  partyWall: "areas.partyWall",
};

export const DIRECTION_KEYS: Record<Direction, MessageKey> = {
  N: "direction.N",
  NE: "direction.NE",
  E: "direction.E",
  SE: "direction.SE",
  S: "direction.S",
  SW: "direction.SW",
  W: "direction.W",
  NW: "direction.NW",
};

export const AREA_HEADER_KEYS: MessageKey[] = [
  "areas.element",
  "areas.direction",
  "areas.tilt",
  "areas.area",
  "areas.u",
  "areas.fx",
  "areas.ht",
  "areas.count",
];
