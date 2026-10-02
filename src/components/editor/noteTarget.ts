import type { MessageKey, Params } from "@/i18n";
import type { Building, NoteTarget } from "@/geometry/types";
import type { Selection } from "@/store/building";

type Translate = (key: MessageKey, params?: Params) => string;

/** The note target for a selection: the element itself, a wall as its whole facade. */
export function noteTargetOf(selection: Selection | null): NoteTarget {
  switch (selection?.kind) {
    case "wall":
      return { kind: "wall", wallIndex: selection.wallIndex };
    case "opening":
      return { kind: "opening", storeyId: selection.storeyId, id: selection.id };
    case "room":
      return { kind: "room", storeyId: selection.storeyId, id: selection.id };
    case "storey":
      return { kind: "storey", id: selection.id };
    default:
      return { kind: "building" };
  }
}

/**
 * The other way round, to jump to a note: the element to select and the storey to show it on.
 * Null for the building, or when the element is gone.
 */
export function selectionOfTarget(
  building: Building,
  target: NoteTarget,
  activeStoreyId: string | null,
): { selection: Selection; storeyId: string | null } | null {
  switch (target.kind) {
    case "building":
      return null;
    case "wall": {
      if (target.wallIndex >= building.footprint.length) return null;
      const storeyId = activeStoreyId ?? building.storeys[0]?.id;
      return storeyId
        ? { selection: { kind: "wall", storeyId, wallIndex: target.wallIndex }, storeyId }
        : null;
    }
    case "storey":
      return building.storeys.some((s) => s.id === target.id)
        ? { selection: { kind: "storey", id: target.id }, storeyId: target.id }
        : null;
    case "opening":
    case "room": {
      const storey = building.storeys.find((s) => s.id === target.storeyId);
      const list = target.kind === "room" ? storey?.rooms : storey?.openings;
      if (!list?.some((item) => item.id === target.id)) return null;
      return { selection: { ...target }, storeyId: target.storeyId };
    }
  }
}

/**
 * Where a note is, as the element tree names it: "Ground floor, Room 1", "Wall 3",
 * "1st floor, Window 2". Null for the building (the caller says "on the building") and for an
 * element that no longer exists.
 */
export function targetLabel(building: Building, target: NoteTarget, t: Translate): string | null {
  switch (target.kind) {
    case "building":
      return null;
    case "wall":
      return t("tree.wall", { n: target.wallIndex + 1 });
    case "storey":
      return building.storeys.find((s) => s.id === target.id)?.name ?? null;
    case "room": {
      const storey = building.storeys.find((s) => s.id === target.storeyId);
      const room = storey?.rooms.find((r) => r.id === target.id);
      return storey && room ? `${storey.name}, ${room.name}` : null;
    }
    case "opening": {
      const storey = building.storeys.find((s) => s.id === target.storeyId);
      const opening = storey?.openings.find((o) => o.id === target.id);
      if (!storey || !opening) return null;
      // Numbered per kind in the storey's order, as the element tree counts them.
      const n = storey.openings.filter((o) => o.kind === opening.kind).indexOf(opening) + 1;
      return `${storey.name}, ${t(opening.kind === "door" ? "tree.door" : "tree.window", { n })}`;
    }
  }
}
