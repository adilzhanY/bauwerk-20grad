import { useEffect, useState } from "react";

/**
 * Keeps the last value on screen for `leaveMs` after it turns null, so a panel can play its
 * exit animation before it unmounts. `leaving` is true during that time.
 */
export function usePresence<T>(
  value: T | null,
  leaveMs: number,
): { shown: T | null; leaving: boolean } {
  const [last, setLast] = useState<T | null>(value);
  // Remember every new value while rendering, the way React adjusts state to a prop.
  if (value !== null && value !== last) setLast(value);

  useEffect(() => {
    if (value !== null) return;
    const timer = setTimeout(() => {
      setLast(null);
    }, leaveMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, leaveMs]);

  return { shown: value ?? last, leaving: value === null && last !== null };
}
