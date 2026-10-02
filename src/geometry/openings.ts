import type { Opening, Vec2 } from "./types";

/** Two openings share a wall when both the index and the interior flag agree. */
export const sameWall = (
  a: Pick<Opening, "wallIndex" | "interior"> & Partial<Opening>,
  b: Pick<Opening, "wallIndex" | "interior"> & Partial<Opening>,
): boolean => a.wallIndex === b.wallIndex && (a.interior ?? false) === (b.interior ?? false);

/** Openings in the building envelope, the ones that matter for energy and IFC. */
export const exteriorOpenings = (openings: readonly Opening[]): Opening[] =>
  openings.filter((o) => !o.interior);

/** Openings on one wall, exterior by default. */
export const openingsOn = (
  openings: readonly Opening[],
  wallIndex: number,
  interior = false,
): Opening[] => openings.filter((o) => sameWall(o, { wallIndex, interior }));

export const OPENING_SNAP = 0.1;
export const MIN_OPENING_SIZE = 0.1;

export type OpeningError =
  | "nonFinite"
  | "outsideWallStart"
  | "outsideWallEnd"
  | "tooSmall"
  | "overlaps"
  | "tooTall"
  | "doorNotOnFloor"
  | "negativeSill";

export interface OpeningContext {
  wallLength: number;
  storeyHeight: number;
  /** Other openings on the same wall. The opening itself is filtered out by id. */
  siblings: readonly Opening[];
}

/** Every invariant from INFO.md, each with its own error code. Empty means valid. */
export function validateOpening(opening: Opening, ctx: OpeningContext): OpeningError[] {
  const errors: OpeningError[] = [];
  const eps = 1e-9;
  if (
    ![
      opening.wallIndex,
      opening.offset,
      opening.width,
      opening.height,
      opening.sill,
      ctx.wallLength,
      ctx.storeyHeight,
    ].every(Number.isFinite) ||
    !Number.isInteger(opening.wallIndex)
  ) {
    return ["nonFinite"];
  }
  if (opening.width < MIN_OPENING_SIZE || opening.height < MIN_OPENING_SIZE)
    errors.push("tooSmall");
  if (opening.offset < -eps) errors.push("outsideWallStart");
  if (opening.offset + opening.width > ctx.wallLength + eps) errors.push("outsideWallEnd");
  if (opening.sill < -eps) errors.push("negativeSill");
  if (opening.sill + opening.height > ctx.storeyHeight + eps) errors.push("tooTall");
  if (opening.kind === "door" && Math.abs(opening.sill) > eps) errors.push("doorNotOnFloor");
  const overlapping = ctx.siblings.some(
    (other) =>
      other.id !== opening.id && sameWall(other, opening) && openingsOverlap(opening, other),
  );
  if (overlapping) errors.push("overlaps");
  return errors;
}

/** Touching edges are not an overlap. Anything past a micrometre is. */
export function openingsOverlap(a: Opening, b: Opening, eps = 1e-6): boolean {
  const aEnd = a.offset + a.width;
  const bEnd = b.offset + b.width;
  return a.offset < bEnd - eps && b.offset < aEnd - eps;
}

/**
 * The openings of one wall that the building physics counts: each valid one, taken in the
 * order they were placed, so an opening dropped over another does not remove the one that
 * was there first. Only the later one is left out until it is moved clear.
 */
export function countedOpenings(
  onWall: readonly Opening[],
  wallLength: number,
  storeyHeight: number,
): Opening[] {
  const counted: Opening[] = [];
  for (const o of onWall)
    if (validateOpening(o, { wallLength, storeyHeight, siblings: counted }).length === 0)
      counted.push(o);
  return counted;
}

export const isOpeningValid = (opening: Opening, ctx: OpeningContext): boolean =>
  validateOpening(opening, ctx).length === 0;

const snap = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Clamp helper for the UI. Brings an opening back inside its wall and storey
 * and forces doors to the floor. It does not resolve overlaps, since which
 * neighbour should give way is the user's call; the validator reports those.
 */
export function clampOpening(opening: Opening, ctx: OpeningContext): Opening {
  const width = Math.min(Math.max(opening.width, MIN_OPENING_SIZE), ctx.wallLength);
  const offset = Math.min(Math.max(opening.offset, 0), ctx.wallLength - width);
  const sill = opening.kind === "door" ? 0 : Math.max(0, opening.sill);
  const height = Math.min(
    Math.max(opening.height, MIN_OPENING_SIZE),
    Math.max(MIN_OPENING_SIZE, ctx.storeyHeight - sill),
  );
  return {
    ...opening,
    width: round(width),
    offset: round(offset),
    sill: round(Math.min(sill, ctx.storeyHeight - height)),
    height: round(height),
  };
}

/** Snap an offset along the wall to the opening grid, keeping it inside the wall. */
export function snapOffset(offset: number, width: number, wallLength: number): number {
  const snapped = snap(offset, OPENING_SNAP);
  return round(Math.min(Math.max(snapped, 0), Math.max(0, wallLength - width)));
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The wall's 2D profile in wall-local coordinates: u runs along the wall from
 * its start, v runs up from the floor. The outer ring is the wall rectangle,
 * counter-clockwise; each hole is a rectangle, clockwise. Invalid openings are
 * skipped so a half-edited opening never produces broken geometry.
 */
export interface WallProfile {
  outer: Vec2[];
  holes: Vec2[][];
}

export function wallProfile(
  wallLength: number,
  storeyHeight: number,
  openings: readonly Opening[],
): WallProfile {
  const outer: Vec2[] = [
    { x: 0, y: 0 },
    { x: wallLength, y: 0 },
    { x: wallLength, y: storeyHeight },
    { x: 0, y: storeyHeight },
  ];
  const holes: Vec2[][] = [];
  for (const o of openings) {
    const valid = isOpeningValid(o, { wallLength, storeyHeight, siblings: openings });
    if (!valid) continue;
    const u0 = o.offset;
    const u1 = o.offset + o.width;
    const v0 = o.sill;
    const v1 = o.sill + o.height;
    holes.push([
      { x: u0, y: v0 },
      { x: u0, y: v1 },
      { x: u1, y: v1 },
      { x: u1, y: v0 },
    ]);
  }
  return { outer, holes };
}

export function defaultOpening(
  kind: Opening["kind"],
): Omit<Opening, "id" | "wallIndex" | "offset" | "constructionId"> {
  return kind === "door"
    ? { kind, width: 1.0, height: 2.1, sill: 0 }
    : { kind, width: 1.2, height: 1.4, sill: 0.9 };
}

/** What a drag in the floor plan takes hold of: the whole opening, or one of its edges. */
export type OpeningGrip = "move" | "start" | "end";

/**
 * The offset and width of `opening` while it is dragged in the floor plan. For "move", `u` is
 * the offset the pointer asks for; for "start" and "end", where that edge should be, in
 * metres along the wall. The result stays on the wall, clear of the openings beside it, at
 * least MIN_OPENING_SIZE wide, and on the centimetre. An opening that already overlaps a
 * neighbour is left as it is.
 */
export function dragOpening(
  opening: Opening,
  siblings: readonly Opening[],
  wallLength: number,
  grip: OpeningGrip,
  u: number,
): { offset: number; width: number } {
  const start = opening.offset;
  const end = opening.offset + opening.width;
  let lo = 0;
  let hi = wallLength;
  for (const other of siblings) {
    if (other.id === opening.id || !sameWall(other, opening)) continue;
    const otherEnd = other.offset + other.width;
    if (otherEnd <= start + 1e-6) lo = Math.max(lo, otherEnd);
    else if (other.offset >= end - 1e-6) hi = Math.min(hi, other.offset);
    else return { offset: start, width: opening.width };
  }
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const cm = Math.round(u * 100) / 100;
  if (grip === "move") {
    if (hi - lo < opening.width - 1e-9) return { offset: start, width: opening.width };
    return { offset: round(clamp(cm, lo, hi - opening.width)), width: opening.width };
  }
  if (grip === "start") {
    const offset = round(clamp(cm, lo, end - MIN_OPENING_SIZE));
    return { offset, width: round(end - offset) };
  }
  return { offset: start, width: round(clamp(cm, start + MIN_OPENING_SIZE, hi) - start) };
}

/** Openings of one kind this close along a wall are one opening in parts (a mullion, a frame). */
const TOUCH = 0.05;

/**
 * Openings are rectangles. Two of the same kind on one wall that overlap or touch along it are
 * one opening stored in parts (an entrance as door and sidelight, from a survey before the
 * survey joined them), shown as a stepped shape: here they become the one rectangle round
 * both, keeping the first one's id and construction.
 */
export function joinTouchingOpenings(openings: readonly Opening[]): Opening[] {
  const out: Opening[] = [];
  for (const o of openings) {
    let current = { ...o };
    let joined = true;
    while (joined) {
      joined = false;
      const i = out.findIndex(
        (k) =>
          k.wallIndex === current.wallIndex &&
          Boolean(k.interior) === Boolean(current.interior) &&
          k.kind === current.kind &&
          k.offset <= current.offset + current.width + TOUCH &&
          current.offset <= k.offset + k.width + TOUCH,
      );
      const k = out[i];
      if (k) {
        const offset = Math.min(k.offset, current.offset);
        const sill = Math.min(k.sill, current.sill);
        current = {
          ...k,
          offset,
          width: Math.max(k.offset + k.width, current.offset + current.width) - offset,
          sill,
          height: Math.max(k.sill + k.height, current.sill + current.height) - sill,
        };
        out.splice(i, 1);
        joined = true;
      }
    }
    out.push(current);
  }
  return out;
}
