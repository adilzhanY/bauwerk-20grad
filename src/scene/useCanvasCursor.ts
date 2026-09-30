import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Sets the cursor of the 3D canvas while `cursor` is not null. It goes on the canvas
 * element itself: the stylesheet gives every canvas the grab hand, which wins over a cursor
 * set on the page body. Null hands the canvas back to the stylesheet. Every 3D hover cursor
 * on the site goes through this.
 */
export function useCanvasCursor(cursor: string | null) {
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (cursor === null) return;
    setCursor(canvas, cursor);
    return () => {
      setCursor(canvas, "");
    };
  }, [canvas, cursor]);
}

/** An empty cursor hands the canvas back to the stylesheet. */
function setCursor(canvas: HTMLElement, cursor: string) {
  canvas.style.cursor = cursor;
}
