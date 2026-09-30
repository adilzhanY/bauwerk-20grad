import type { NoteTarget } from "@/geometry/types";
import type { Selection } from "@/store/building";

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
