import { useEffect, useState } from "react";

/**
 * The site's enter and exit duration, milliseconds. Kept equal to --motion-duration in
 * index.css; code that waits for an exit before it unmounts uses this, never its own number.
 */
export const MOTION_MS = 220;

/**
 * Keeps the last value on screen for `leaveMs` after it turns null, so a panel can play its
 * exit animation before it unmounts. `leaving` is true during that time. With reduced
 * motion the exit has no animation, so the value goes at once.
 */
export function usePresence<T>(
  value: T | null,
  leaveMs: number = MOTION_MS,
): { shown: T | null; leaving: boolean } {
  // Always through a function: a value that is itself a function (a dialog's answer) would
  // otherwise be taken by React as an updater and called while rendering.
  const [last, setLast] = useState<T | null>(() => value);
  // Remember every new value while rendering, the way React adjusts state to a prop.
  if (value !== null && value !== last) setLast(() => value);
  // Without motion there is no exit to wait for: the content goes in the same render.
  const instant = value === null && last !== null && reducedMotion();
  if (instant) setLast(null);

  useEffect(() => {
    if (value !== null) return;
    const timer = setTimeout(
      () => {
        setLast(null);
      },
      reducedMotion() ? 0 : leaveMs,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [value, leaveMs]);

  if (instant) return { shown: null, leaving: false };
  return { shown: value ?? last, leaving: value === null && last !== null };
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
