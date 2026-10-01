/**
 * Edits to a building as small operations, so two people editing different parts of one
 * building do not overwrite each other.
 *
 * `diffBuilding(prev, next)` turns any change into operations and `applyOps` replays them.
 * Nothing in the store has to emit operations: every action already produces a new building
 * through Immer, and unchanged parts keep their references, so the diff only walks what
 * changed.
 *
 * Paths address values by key. Arrays whose items all carry an `id` (storeys, openings,
 * rooms, zones, constructions, layers, radiators, pipes, heat pumps, scenarios) are
 * addressed per item with an `{ id }` step, so an edit keeps pointing at the same opening
 * while others insert or remove openings around it. Every other array (the footprint, the
 * interior wall segments, polygons, shared edges) is one value and is replaced whole.
 *
 * Merging is per property, last writer wins: two edits to different fields of one opening
 * both survive, two edits to the same field keep the later one. An operation whose target
 * was deleted in the meantime is dropped. Pure, no store and no Three.js, so the server
 * runs the same code.
 */

/** One step of a path: an object key, or an item of an id array. */
export type PathStep = string | { id: string };
export type Path = PathStep[];

export type Op =
  /** Set a value, creating the key when it is missing. */
  | { op: "set"; path: Path; value: unknown }
  /** Delete an optional key. */
  | { op: "del"; path: Path }
  /** Insert an item into the id array at `path`, right after the item `after` (null: first). */
  | { op: "insert"; path: Path; value: { id: string }; after: string | null }
  /** Remove the item `id` from the id array at `path`. */
  | { op: "remove"; path: Path; id: string }
  /** Put the id array at `path` into this order. Items not named keep their place at the end. */
  | { op: "order"; path: Path; ids: string[] };

type Json = unknown;
type Obj = Record<string, Json>;
type Item = Obj & { id: string };

const isObject = (value: Json): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Items with unique ids. A duplicated id (a corrupt or imported file) is one plain value. */
const isIdArray = (value: Json): value is Item[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => isObject(item) && typeof item.id === "string") &&
  new Set(value.map((item) => (item as Item).id)).size === value.length;

/** Two id arrays, or an empty array beside an id array: diffed per item. */
function bothIdArrays(a: Json, b: Json): a is Item[] {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length === 0 && b.length === 0) return false;
  return (a.length === 0 || isIdArray(a)) && (b.length === 0 || isIdArray(b));
}

/** Deep equality for JSON values. */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    const other = Object.keys(b).filter((k) => b[k] !== undefined);
    return keys.length === other.length && keys.every((k) => sameJson(a[k], b[k]));
  }
  return false;
}

/** The operations that turn `prev` into `next`. Empty when they are equal. */
export function diffBuilding(prev: unknown, next: unknown): Op[] {
  const out: Op[] = [];
  diff(prev, next, [], out);
  return out;
}

function diff(prev: Json, next: Json, path: Path, out: Op[]) {
  if (prev === next) return;
  if (isObject(prev) && isObject(next)) {
    for (const key of Object.keys(prev)) {
      if (prev[key] !== undefined && next[key] === undefined)
        out.push({ op: "del", path: [...path, key] });
    }
    for (const key of Object.keys(next)) {
      const value = next[key];
      if (value === undefined) continue;
      if (prev[key] === undefined) out.push({ op: "set", path: [...path, key], value });
      else diff(prev[key], value, [...path, key], out);
    }
    return;
  }
  if (bothIdArrays(prev, next)) {
    diffItems(prev, next as Item[], path, out);
    return;
  }
  if (!sameJson(prev, next)) out.push({ op: "set", path, value: next });
}

function diffItems(prev: Item[], next: Item[], path: Path, out: Op[]) {
  const before = new Map(prev.map((item) => [item.id, item]));
  const after = new Set(next.map((item) => item.id));
  for (const item of prev) {
    if (!after.has(item.id)) out.push({ op: "remove", path, id: item.id });
  }
  let previousId: string | null = null;
  for (const item of next) {
    const old = before.get(item.id);
    if (old) diff(old, item, [...path, { id: item.id }], out);
    else out.push({ op: "insert", path, value: item, after: previousId });
    previousId = item.id;
  }
  // Inserts land after their neighbour, so only a change in the order of the items both
  // sides have needs an order op.
  const kept = prev.filter((item) => after.has(item.id)).map((item) => item.id);
  const keptNext = next.filter((item) => before.has(item.id)).map((item) => item.id);
  if (!kept.every((id, i) => id === keptNext[i])) {
    out.push({ op: "order", path, ids: next.map((item) => item.id) });
  }
}

/** The outcome of replaying operations: the new value and the operations that found no target. */
export interface Applied<T> {
  value: T;
  dropped: Op[];
}

/** Thrown inside one operation whose target is gone; that operation is dropped. */
class Dropped extends Error {}

/**
 * Replays `ops` on `value` without changing it. Untouched parts keep their references. An
 * operation whose path leads to an item that no longer exists is dropped and reported.
 */
export function applyOps<T>(value: T, ops: readonly Op[]): Applied<T> {
  let current: Json = value;
  const dropped: Op[] = [];
  for (const op of ops) {
    try {
      current = applyOne(current, op);
    } catch (error) {
      if (!(error instanceof Dropped)) throw error;
      dropped.push(op);
    }
  }
  return { value: current as T, dropped };
}

function applyOne(root: Json, op: Op): Json {
  if (op.op === "set" || op.op === "del") {
    const last = op.path.at(-1);
    if (last === undefined) {
      if (op.op === "del") throw new Dropped();
      return op.value;
    }
    return update(root, op.path.slice(0, -1), (parent) => {
      if (typeof last === "string") {
        if (!isObject(parent)) throw new Dropped();
        if (op.op === "del") {
          if (!(last in parent)) return parent;
          const rest = { ...parent };
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is the op's
          delete rest[last];
          return rest;
        }
        return { ...parent, [last]: op.value };
      }
      // Replacing a whole item of an id array.
      if (!isIdArray(parent) || op.op === "del") throw new Dropped();
      const index = parent.findIndex((item) => item.id === last.id);
      if (index < 0) throw new Dropped();
      const items = [...parent];
      items[index] = op.value as Item;
      return items;
    });
  }
  return update(root, op.path, (target) => {
    if (!Array.isArray(target)) throw new Dropped();
    const items = target as Item[];
    switch (op.op) {
      case "insert": {
        if (items.some((item) => item.id === op.value.id)) throw new Dropped();
        // After its neighbour; first when it had none; last when the neighbour is gone.
        const anchor = op.after === null ? -1 : items.findIndex((item) => item.id === op.after);
        const at = op.after !== null && anchor < 0 ? items.length : anchor + 1;
        return [...items.slice(0, at), op.value as Item, ...items.slice(at)];
      }
      case "remove": {
        if (!items.some((item) => item.id === op.id)) throw new Dropped();
        return items.filter((item) => item.id !== op.id);
      }
      case "order": {
        const rank = new Map(op.ids.map((id, i) => [id, i]));
        const named = items.filter((item) => rank.has(item.id));
        named.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        return [...named, ...items.filter((item) => !rank.has(item.id))];
      }
    }
  });
}

/** Rebuilds the spine from `root` to `path` around `change`, copying only what it passes. */
function update(root: Json, path: Path, change: (target: Json) => Json): Json {
  const step = path[0];
  if (step === undefined) return change(root);
  const rest = path.slice(1);
  if (typeof step === "string") {
    if (!isObject(root) || !(step in root)) throw new Dropped();
    const child = update(root[step], rest, change);
    return child === root[step] ? root : { ...root, [step]: child };
  }
  if (!Array.isArray(root)) throw new Dropped();
  const index = (root as Json[]).findIndex((item) => isObject(item) && item.id === step.id);
  if (index < 0) throw new Dropped();
  const child = update(root[index], rest, change);
  if (child === root[index]) return root;
  const items = [...(root as Json[])];
  items[index] = child;
  return items;
}

/** The value at `path`, or undefined when there is none. */
export function valueAt(root: unknown, path: Path): unknown {
  let current: Json = root;
  for (const step of path) {
    if (typeof step === "string") {
      if (!isObject(current)) return undefined;
      current = current[step];
    } else {
      if (!Array.isArray(current)) return undefined;
      current = (current as Json[]).find((item) => isObject(item) && item.id === step.id);
    }
  }
  return current;
}

/** Most operations one batch may carry. Loading a whole example building is well below it. */
export const MAX_BATCH_OPS = 20000;

/** Keys a path may never walk into. */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const isStep = (step: unknown): step is PathStep =>
  (typeof step === "string" && step.length <= 200 && !FORBIDDEN_KEYS.has(step)) ||
  (isObject(step) &&
    Object.keys(step).length === 1 &&
    typeof step.id === "string" &&
    step.id.length <= 200);

const isPath = (value: unknown): value is Path =>
  Array.isArray(value) && value.length <= 32 && value.every(isStep);

const isIdOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.length <= 200);

/**
 * Checks operations that came over the network. Returns them typed, or null when anything
 * is malformed. Values are not checked here: the building they produce is validated whole.
 */
export function parseOps(value: unknown): Op[] | null {
  if (!Array.isArray(value) || value.length > MAX_BATCH_OPS) return null;
  for (const op of value as unknown[]) {
    if (!isObject(op) || !isPath(op.path)) return null;
    switch (op.op) {
      case "set":
        if (!("value" in op)) return null;
        break;
      case "del":
        break;
      case "insert":
        if (!isObject(op.value) || typeof op.value.id !== "string" || !isIdOrNull(op.after))
          return null;
        break;
      case "remove":
        if (typeof op.id !== "string") return null;
        break;
      case "order":
        if (!Array.isArray(op.ids) || !op.ids.every((id) => typeof id === "string")) return null;
        break;
      default:
        return null;
    }
  }
  return value as Op[];
}
