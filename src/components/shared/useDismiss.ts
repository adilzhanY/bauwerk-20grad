import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Closes a menu or popover while `open`: on a press anywhere outside `root` (which holds the
 * trigger and the popover, so the trigger's own click still toggles it) and on Escape.
 */
export function useDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, root]);
}
