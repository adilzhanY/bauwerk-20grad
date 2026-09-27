import { isOpeningValid } from "./openings";
import { add, scale, sub } from "./polygon";
import type { Opening, Vec2 } from "./types";
import { wallPlanSlice } from "./walls";
import type { Wall } from "./walls";

/**
 * The 2D plan drawing of a storey, as an architect draws it: walls cut and filled between
 * their faces, openings as breaks in the wall with their symbol, and dimension lines outside.
 * Everything is plan metres; the scene lifts it onto the storey.
 */

export type PlanLine = [Vec2, Vec2];

/** The solid parts of a wall in plan: the wall quad minus every valid opening. */
export function wallPoche(wall: Wall, openings: readonly Opening[]): Vec2[][] {
  const spans = openingSpans(wall, openings);
  const solids: Vec2[][] = [];
  let cursor = 0;
  for (const [u0, u1] of spans) {
    if (u0 > cursor + 1e-9) solids.push(wallPlanSlice(wall, cursor, u0));
    cursor = Math.max(cursor, u1);
  }
  if (cursor < wall.length - 1e-9) solids.push(wallPlanSlice(wall, cursor, wall.length));
  return solids;
}

/** Valid openings as [start, end] metres along the outer face, sorted. */
export function openingSpans(wall: Wall, openings: readonly Opening[]): [number, number][] {
  return openings
    .filter((o) =>
      isOpeningValid(o, { wallLength: wall.length, storeyHeight: wall.height, siblings: openings }),
    )
    .map((o): [number, number] => [o.offset, o.offset + o.width])
    .sort((a, b) => a[0] - b[0]);
}

export interface OpeningSymbol {
  /** The two cut ends of the wall on either side of the opening. */
  jambs: PlanLine[];
  /** Windows: the outer and inner sill and the glass between them. Doors: the threshold. */
  lines: PlanLine[];
  /** Doors: the leaf standing open into the room, hinged at the start of the opening. */
  leaf: PlanLine | null;
  /** Doors: the quarter circle the leaf sweeps. */
  arc: Vec2[];
}

const ARC_STEPS = 16;

/** The plan symbol of one opening in its wall. */
export function openingSymbol(wall: Wall, opening: Opening): OpeningSymbol {
  const u0 = opening.offset;
  const u1 = opening.offset + opening.width;
  const [outer0, outer1, inner1, inner0] = wallPlanSlice(wall, u0, u1);
  const jambs: PlanLine[] = [
    [outer0, inner0],
    [outer1, inner1],
  ];
  if (opening.kind === "window") {
    const mid = (a: Vec2, b: Vec2): Vec2 => scale(add(a, b), 0.5);
    return {
      jambs,
      lines: [
        [outer0, outer1],
        [mid(outer0, inner0), mid(outer1, inner1)],
        [inner0, inner1],
      ],
      leaf: null,
      arc: [],
    };
  }
  // The door opens into the building: away from the outer face, hinged at the start.
  const inward = scale(wall.normal, -1);
  const open = add(inner0, scale(inward, opening.width));
  const arc: Vec2[] = [];
  const closed = sub(inner1, inner0);
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = (i / ARC_STEPS) * (Math.PI / 2);
    // From the open leaf back to the closed position across the gap.
    arc.push(
      add(inner0, add(scale(inward, opening.width * Math.cos(t)), scale(closed, Math.sin(t)))),
    );
  }
  return { jambs, lines: [[inner0, inner1]], leaf: [inner0, open], arc };
}

export interface Dimension {
  /** The dimension line, parallel to the measured distance. */
  line: PlanLine;
  /** Extension lines from near the measured points to just past the dimension line. */
  extensions: PlanLine[];
  /** The 45 degree ticks at both ends. */
  ticks: PlanLine[];
  /** Where the label sits: the middle of the dimension line. */
  label: Vec2;
  /** The measured distance in metres. */
  length: number;
}

/** The small sizes of a dimension, in metres, so a caller can keep them constant on screen. */
export interface DimensionStyle {
  /** Gap between the measured point and the start of an extension line. */
  gap: number;
  /** How far an extension line runs past the dimension line. */
  overrun: number;
  /** Half the length of a tick. */
  tick: number;
}

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = { gap: 0.15, overrun: 0.2, tick: 0.14 };

/**
 * An architect's dimension between two points, drawn `offset` metres out along `normal`:
 * the line, the extension lines back toward the points, and a 45 degree tick at each end.
 */
export function dimension(
  a: Vec2,
  b: Vec2,
  normal: Vec2,
  offset: number,
  style: DimensionStyle = DEFAULT_DIMENSION_STYLE,
): Dimension {
  const out = (p: Vec2, k: number) => add(p, scale(normal, k));
  const lineA = out(a, offset);
  const lineB = out(b, offset);
  const d = sub(b, a);
  const length = Math.hypot(d.x, d.y);
  const along = length > 0 ? scale(d, 1 / length) : { x: 1, y: 0 };
  // A tick leans 45 degrees between the line and the normal.
  const slash = scale(add(along, normal), style.tick / Math.SQRT2);
  const tick = (p: Vec2): PlanLine => [sub(p, slash), add(p, slash)];
  return {
    line: [lineA, lineB],
    extensions: [
      [out(a, style.gap), out(a, offset + style.overrun)],
      [out(b, style.gap), out(b, offset + style.overrun)],
    ],
    ticks: [tick(lineA), tick(lineB)],
    label: scale(add(lineA, lineB), 0.5),
    length,
  };
}

/**
 * The chain of dimensions along a wall with openings: wall piece, opening, wall piece and so
 * on, each measured on the outer face. Empty when the wall has no valid opening.
 */
export function openingChain(
  wall: Wall,
  openings: readonly Opening[],
  offset: number,
  style: DimensionStyle = DEFAULT_DIMENSION_STYLE,
): Dimension[] {
  const spans = openingSpans(wall, openings);
  if (spans.length === 0) return [];
  const stops = [0];
  for (const [u0, u1] of spans) stops.push(u0, u1);
  stops.push(wall.length);
  const at = (u: number) => add(wall.outerA, scale(wall.direction, u));
  const chain: Dimension[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const u0 = stops[i] ?? 0;
    const u1 = stops[i + 1] ?? 0;
    // Openings flush with a corner leave a zero piece; there is nothing to measure there.
    if (u1 - u0 > 1e-6) chain.push(dimension(at(u0), at(u1), wall.normal, offset, style));
  }
  return chain;
}
