import { useEffect, useState } from "react";

/**
 * Seconds the job has been running, redrawn ten times a second while it runs. Once it has
 * ended, the exact total from `endedAt`.
 */
export function useElapsed(startedAt: number, endedAt: number | undefined): number {
  const [now, setNow] = useState(() => performance.now());
  const running = endedAt === undefined;
  useEffect(() => {
    // Until the first tick `now` may predate `startedAt`; the clamp below shows 0 then.
    if (!running) return;
    const timer = setInterval(() => {
      setNow(performance.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [running, startedAt]);
  return Math.max(0, ((endedAt ?? now) - startedAt) / 1000);
}
