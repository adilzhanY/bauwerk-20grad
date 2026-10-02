import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useAuth } from "@/auth/store";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Presence, Selection } from "@/store/building";

/**
 * Pointer hover handlers that write to the store at most once per animation
 * frame, so the viewport does not re-render on every mouse move.
 */
export function useHover(target: Selection | null, enabled = true) {
  const setHovered = useEditorStore((s) => s.setHovered);
  const pending = useRef<Selection | null | undefined>(undefined);
  const frame = useRef<number | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    if (pending.current !== undefined) setHovered(pending.current);
    pending.current = undefined;
  }, [setHovered]);

  const schedule = useCallback(
    (value: Selection | null) => {
      pending.current = value;
      frame.current ??= requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(() => {
    if (enabled) return;
    const current = useEditorStore.getState().hovered;
    const queued = pending.current;
    if (sameSelection(current, target) || (queued !== undefined && sameSelection(queued, target))) {
      schedule(null);
    }
  }, [enabled, schedule, target]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const current = useEditorStore.getState().hovered;
      if (sameSelection(current, target)) setHovered(null);
    },
    [setHovered, target],
  );

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      schedule(target);
    },
    [enabled, schedule, target],
  );
  const onPointerOut = useCallback(() => {
    schedule(null);
  }, [schedule]);

  return { onPointerOver, onPointerOut };
}

/**
 * True inside the project card's picture of the building (ModelThumbnail): nothing there is
 * selected or hovered, whatever the editor has.
 */
export const PictureMode = createContext(false);

/**
 * The colour of someone else who has this target selected, or null. Only other people: a
 * second tab of one's own (same account) shares one's colour, and one's own selection is
 * drawn as the selection, never in one's presence colour.
 */
export function remoteSelectionColor(
  presence: readonly Presence[],
  target: Selection,
  me: string | null,
): string | null {
  return (
    presence.find((p) => (me === null || p.userId !== me) && sameSelection(p.selection, target))
      ?.color ?? null
  );
}

export function useRemoteColor(target: Selection): string | null {
  const me = useAuth((s) => s.account?.id ?? null);
  return useEditorStore((s) => remoteSelectionColor(s.presence, target, me));
}

/** Whether this target is selected and hovered, as the parts of the building draw it. */
export function useMarked(target: Selection | null): { selected: boolean; hovered: boolean } {
  const picture = useContext(PictureMode);
  const selected = useEditorStore((s) => !picture && sameSelection(s.selection, target));
  const hovered = useEditorStore((s) => !picture && sameSelection(s.hovered, target));
  return { selected, hovered };
}
