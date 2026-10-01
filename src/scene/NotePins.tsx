import { Html } from "@react-three/drei";
import { MessageSquare } from "lucide-react";
import { pinPosition, sameTarget } from "@/geometry/notes";
import type { NoteTarget } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { useThreads } from "@/projects/threads";

/**
 * A pin in 3D for every element with open notes, with their number. A click selects the
 * element, which shows its notes in the properties panel. Drawn in plan space, inside the
 * Viewport's mirror group.
 */
export function NotePins() {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const planView = useEditorStore((s) => s.planView);
  const select = useEditorStore((s) => s.select);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const serverProject = useEditorStore((s) => s.projectId !== null);
  const threads = useThreads((s) => s.threads);
  if (planView) return null;

  // In a server project the open threads, otherwise the building's own notes.
  const open: { target: NoteTarget }[] = serverProject
    ? threads.filter((thread) => !thread.resolvedAt).map((thread) => ({ target: thread.target }))
    : (building.notes ?? []).filter((n) => !n.done);
  const groups: { target: NoteTarget; count: number }[] = [];
  for (const note of open) {
    const group = groups.find((g) => sameTarget(g.target, note.target));
    if (group) group.count += 1;
    else groups.push({ target: note.target, count: 1 });
  }

  return (
    <>
      {groups.map(({ target, count }) => {
        const pin = pinPosition(building, target);
        if (!pin) return null;
        const key = JSON.stringify(target);
        return (
          <Html
            key={key}
            position={[pin.point.x, pin.height, pin.point.y]}
            center
            zIndexRange={[15, 0]}
          >
            <button
              type="button"
              aria-label={t("notes.pin", { n: count })}
              title={t("notes.pin", { n: count })}
              onClick={() => {
                if (target.kind === "building") clearSelection();
                else if (target.kind === "wall") {
                  const storeyId = building.storeys[0]?.id;
                  if (storeyId) select({ kind: "wall", storeyId, wallIndex: target.wallIndex });
                } else select(target);
              }}
              className="flex items-center gap-1 rounded-control bg-select px-1.5 py-1 text-xs font-semibold text-white shadow-float"
            >
              <MessageSquare size={13} aria-hidden />
              {count}
            </button>
          </Html>
        );
      })}
    </>
  );
}
