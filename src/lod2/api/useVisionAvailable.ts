import { useEffect, useState } from "react";
import { visionAvailable } from "./vision.ts";

/** How often to ask lod2-vision whether it is there, so starting it later is noticed. */
const VISION_POLL_MS = 15000;

/**
 * Whether lod2-vision answers. Checked when the panel mounts and every 15 seconds after,
 * independent of which building or wall is selected. Null until the first answer, so the
 * panel does not flash a button that then disappears. `enabled` false stops asking, for a
 * part of the page that is not on screen.
 */
export function useVisionAvailable(enabled = true): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const check = () => {
      void visionAvailable(controller.signal).then((ok) => {
        if (!controller.signal.aborted) setAvailable(ok);
      });
    };
    check();
    const timer = setInterval(check, VISION_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [enabled]);
  return available;
}
