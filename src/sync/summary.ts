/**
 * What a set of changes did, in words a person reads (TODO Part 21, CG.1): walls changed,
 * doors added, the roof changed. Counts the distinct things touched, not the operations, so
 * dragging one window in ten steps is one window changed. Pure: the server writes it into the
 * version list, the History tab merges it per session, the compare view uses it too.
 */
import type { Op, Path } from "./ops";

export const CHANGE_KINDS = [
  "walls",
  "doors",
  "windows",
  "openings",
  "rooms",
  "storeys",
  "outline",
  "roof",
  "scenarios",
  "constructions",
  "heating",
  "project",
  "other",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface ChangeCount {
  added: number;
  removed: number;
  changed: number;
}

export type ChangeSummary = Partial<Record<ChangeKind, ChangeCount>>;

const idOf = (step: Path[number] | undefined) => (typeof step === "object" ? step.id : undefined);

/** Which kind of thing an operation's path points at, and that thing's id if it has one. */
function kindOf(op: Op): { kind: ChangeKind; id: string } {
  const [first, second, third] = op.path;
  if (first === "storeys") {
    const storey = idOf(second) ?? "";
    if (op.path.length <= 1) return { kind: "storeys", id: op.op === "remove" ? op.id : storey };
    if (third === "interiorWalls") return { kind: "walls", id: `${storey}:walls` };
    if (third === "openings") {
      const id = idOf(op.path[3]) ?? (op.op === "remove" ? op.id : "");
      if (op.op === "insert") {
        const kind = (op.value as { kind?: unknown }).kind;
        return {
          kind: kind === "door" ? "doors" : kind === "window" ? "windows" : "openings",
          id: op.value.id,
        };
      }
      return { kind: "openings", id };
    }
    if (third === "rooms")
      return { kind: "rooms", id: idOf(op.path[3]) ?? (op.op === "remove" ? op.id : "") };
    if (third === "radiators" || third === "pipes")
      return { kind: "heating", id: `${storey}:${third}` };
    return { kind: "storeys", id: storey };
  }
  const key = typeof first === "string" ? first : "";
  if (
    key === "footprint" ||
    key === "origin" ||
    key === "wallThickness" ||
    key === "sharedEdges" ||
    key === "photoSlots"
  )
    return { kind: "outline", id: key };
  if (key === "roof" || key === "roofConstructionId") return { kind: "roof", id: "roof" };
  if (key === "scenarios")
    return { kind: "scenarios", id: idOf(second) ?? (op.op === "remove" ? op.id : "") };
  if (key === "constructions" || key.endsWith("ConstructionId"))
    return { kind: "constructions", id: idOf(second) ?? key };
  if (key === "heating" || key === "heatPumps") return { kind: "heating", id: key };
  if (key === "project" || key === "name") return { kind: "project", id: key };
  return { kind: "other", id: key };
}

/** How deep each kind's own list lies: storeys at the top, openings and rooms in a storey. */
const OWN_LIST_DEPTH: Partial<Record<ChangeKind, number>> = {
  storeys: 1,
  scenarios: 1,
  constructions: 1,
  doors: 3,
  windows: 3,
  openings: 3,
  rooms: 3,
};

/** The distinct things a set of operations added, removed or changed, by kind. */
export function summarizeOps(ops: readonly Op[]): ChangeSummary {
  const seen = new Map<
    ChangeKind,
    { added: Set<string>; removed: Set<string>; changed: Set<string> }
  >();
  for (const op of ops) {
    const { kind, id } = kindOf(op);
    let sets = seen.get(kind);
    if (!sets) {
      sets = { added: new Set(), removed: new Set(), changed: new Set() };
      seen.set(kind, sets);
    }
    // Inserting into or removing from the kind's own list adds or removes one; inside it
    // (a layer of a construction) it changes the one that holds it.
    const own = OWN_LIST_DEPTH[kind] === op.path.length;
    if (op.op === "insert" && own) sets.added.add(id);
    else if (op.op === "remove" && own) sets.removed.add(id);
    else sets.changed.add(id);
  }
  const summary: ChangeSummary = {};
  for (const [kind, sets] of seen) {
    // Something added and then changed in the same set counts once, as added.
    for (const id of [...sets.added, ...sets.removed]) sets.changed.delete(id);
    summary[kind] = {
      added: sets.added.size,
      removed: sets.removed.size,
      changed: sets.changed.size,
    };
  }
  return summary;
}

/** Two summaries together: one session made of several versions. */
export function mergeSummaries(a: ChangeSummary, b: ChangeSummary): ChangeSummary {
  const out: ChangeSummary = { ...a };
  for (const kind of CHANGE_KINDS) {
    const x = out[kind];
    const y = b[kind];
    if (!y) continue;
    out[kind] = x
      ? { added: x.added + y.added, removed: x.removed + y.removed, changed: x.changed + y.changed }
      : { ...y };
  }
  return out;
}
