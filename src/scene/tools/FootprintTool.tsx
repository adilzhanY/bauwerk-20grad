import { useMemo, useState } from "react";
import { Line } from "../Line";
import type { ThreeEvent } from "@react-three/fiber";
import { isCounterClockwise, isSimplePolygon, snapPoint } from "@/geometry/polygon";
import { GRID_SIZE } from "@/geometry/types";
import type { Vec2 } from "@/geometry/types";
import { colors } from "@/lib/colors";
import { sameSelection, useEditorStore } from "@/store/building";
import { pointOnLevel } from "./plane";
import { useDragLock } from "./useDragLock";

interface Drag {
  index: number;
  preview: Vec2[];
  valid: boolean;
}

/**
 * Draggable vertex handles on the ground plane, snapped to the grid, with live
 * validation. An invalid shape is drawn in the warning colour and is not
 * committed when the pointer is released.
 */
export function FootprintTool() {
  const footprint = useEditorStore((s) => s.building.footprint);
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const setFootprintVertex = useEditorStore((s) => s.setFootprintVertex);
  const insertFootprintVertex = useEditorStore((s) => s.insertFootprintVertex);
  const lock = useDragLock();
  const [drag, setDrag] = useState<Drag | null>(null);

  const shown = drag?.preview ?? footprint;
  const outline = useMemo(
    () =>
      [...shown, shown[0] ?? { x: 0, y: 0 }].map(
        (p) => [p.x, 0.02, p.y] as [number, number, number],
      ),
    [shown],
  );
  const midpoints = useMemo(
    () =>
      footprint.map((a, i) => {
        const b = footprint[(i + 1) % footprint.length] ?? a;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }),
    [footprint],
  );

  const onDown = (index: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    lock(true);
    select({ kind: "vertex", index });
    setDrag({ index, preview: footprint, valid: true });
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    const hit = pointOnLevel(e, 0);
    if (!hit) return;
    const snapped = snapPoint(hit, GRID_SIZE);
    const preview = footprint.map((p, i) => (i === drag.index ? snapped : p));
    setDrag({ ...drag, preview, valid: isSimplePolygon(preview) && isCounterClockwise(preview) });
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (!drag) return;
    lock(false);
    const moved = drag.preview[drag.index];
    const original = footprint[drag.index];
    if (drag.valid && moved && original && (moved.x !== original.x || moved.y !== original.y)) {
      setFootprintVertex(drag.index, moved);
    }
    setDrag(null);
  };

  const onCancel = (e: ThreeEvent<PointerEvent>) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (!drag) return;
    lock(false);
    setDrag(null);
  };

  const lineColor = drag ? (drag.valid ? colors.accent : colors.warning) : colors.accent;

  return (
    <group>
      <Line points={outline} color={lineColor} lineWidth={2} />
      {shown.map((p, index) => {
        const selected = sameSelection(selection, { kind: "vertex", index });
        const color = drag && !drag.valid ? colors.warning : selected ? colors.accent : colors.fg;
        return (
          <mesh
            key={index}
            position={[p.x, 0.08, p.y]}
            onPointerDown={onDown(index)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
          >
            <sphereGeometry args={[0.16, 16, 16]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}
      {!drag &&
        midpoints.map((m, index) => (
          <mesh
            key={`mid-${index}`}
            position={[m.x, 0.06, m.y]}
            onClick={(e) => {
              e.stopPropagation();
              insertFootprintVertex(index);
            }}
          >
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshBasicMaterial color={colors.muted} />
          </mesh>
        ))}
    </group>
  );
}
