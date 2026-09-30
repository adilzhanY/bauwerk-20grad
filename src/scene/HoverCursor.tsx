import { useEditorStore } from "@/store/building";
import { useCanvasCursor } from "./useCanvasCursor";

/**
 * The pointing hand over anything in the 3D view that a click selects. Every selectable
 * element already reports itself as `hovered` through useHover, so this one place turns
 * that into the cursor instead of each element setting its own.
 */
export function HoverCursor() {
  const hovered = useEditorStore((s) => s.hovered);
  const tool = useEditorStore((s) => s.tool);
  useCanvasCursor(hovered !== null && (tool === "select" || tool === "zone") ? "pointer" : null);
  return null;
}
