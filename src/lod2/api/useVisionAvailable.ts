import { useEffect, useState } from "react";
import { visionAvailable } from "./vision.ts";

/** How often to ask lod2-vision whether it is there, so starting it later is noticed. */
const VISION_POLL_MS = 15000;

/**
 * Whether lod2-vision answers. Checked when the panel mounts and every 15 seconds after,
 * independent of which building or wall is selected. Null until the first answer, so the
 * panel does not flash a button that then disappears.
 */
export function useVisionAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
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
  }, []);
  return available;
}
