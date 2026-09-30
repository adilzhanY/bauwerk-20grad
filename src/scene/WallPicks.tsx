import { useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { effectiveWallThickness } from "@/geometry/layers";
import { add, dot, normalize, scale, sub } from "@/geometry/polygon";
import type { Id, Segment, Vec2 } from "@/geometry/types";
import { interiorWallThickness } from "@/geometry/constructions";
import { moveWall, pieceRange } from "@/geometry/wallGraph";
import type { MoveContext, WallSet } from "@/geometry/wallGraph";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { HitStrip } from "./HitStrip";
import { useHover } from "./hover";
import { Cross } from "./Marks";
import { pointOnLevel } from "./tools/plane";
import { useDragLock } from "./tools/useDragLock";
import { useCanvasCursor } from "./useCanvasCursor";
import { useSceneColors } from "./useSceneColors";

/** Screen pixels to each side of an interior wall that pick it: 10 cm is only a few pixels. */
const PICK_PX = 8;
/** Under the grips of openings, over the drawing and the floor. */
const LIFT = 0.02;

const cm = (v: number) => Math.round(v * 100) / 100;

/**
 * In the floor plan, each interior wall (a piece from joint to joint, geometry/wallGraph.ts)
 * takes a click along a strip wider than the wall, so the select tool can pick it. A picked
 * wall moves sideways by dragging it, as energy consultants move walls in their software:
 * its ends slide along the walls they meet, those walls grow or shorten to stay joined, every
 * dimension follows live, and the drag is one undo step. Where the move cannot keep the walls
 * joined (over another wall, onto a door or window, out of the building) a red cross shows
 * and the wall stays where it last could be.
 */
export function WallPicks({ storeyId, y, zoom }: { storeyId: Id; y: number; zoom: number }) {
  const tool = useEditorStore((s) => s.tool);
  const building = useEditorStore((s) => s.building);
  const storey = building.storeys.find((s) => s.id === storeyId);
  if (tool !== "select" || !storey) return null;
  const ctx: MoveContext = {
    footprint: building.footprint,
    exteriorThickness: effectiveWallThickness(building),
    thicknessOf: interiorWallThickness(building.constructions),
  };
  const pick = PICK_PX / Math.max(zoom, 1e-6);
  return (
    <group position={[0, LIFT, 0]}>
      {storey.interiorWalls.map((segment, index) => (
        <WallPick
          key={index}
          storeyId={storeyId}
          index={index}
          segment={segment}
          range={pieceRange(index, storey.interiorWalls, ctx)}
          width={Math.max(pick, ctx.thicknessOf(segment) / 2)}
          ctx={ctx}
          y={y}
          cross={PICK_PX / 1.5 / Math.max(zoom, 1e-6)}
        />
      ))}
    </group>
  );
}

interface Drag {
  from: Vec2;
  normal: Vec2;
  index: number;
  /** The storey's walls when the drag began: every move is measured from these. */
  base: WallSet;
}

function WallPick({
  storeyId,
  index,
  segment,
  range,
  width,
  ctx,
  y,
  cross,
}: {
  storeyId: Id;
  index: number;
  segment: Segment;
  range: [number, number];
  width: number;
  ctx: MoveContext;
  y: number;
  cross: number;
}) {
  const target: Selection = useMemo(
    () => ({ kind: "interiorWall", storeyId, index }),
    [storeyId, index],
  );
  const selected = useEditorStore((s) => sameSelection(s.selection, target));
  const select = useEditorStore((s) => s.select);
  const applyWallEdit = useEditorStore((s) => s.applyWallEdit);
  const scene = useSceneColors();
  const hover = useHover(target);
  const lock = useDragLock();
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<Vec2 | null>(null);
  const dir = normalize(sub(segment.b, segment.a));
  const normal = { x: -dir.y, y: dir.x };
  // A picked wall moves across itself: the arrows of the cursor say which way.
  const across = Math.abs(normal.x) >= Math.abs(normal.y) ? "ew-resize" : "ns-resize";
  useCanvasCursor(dragging || (selected && over) ? across : null);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    select(target);
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!selected || e.button !== 0) return;
    const p = pointOnLevel(e, y + LIFT);
    if (!p) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const storey = useEditorStore.getState().building.storeys.find((s) => s.id === storeyId);
    if (!storey) return;
    drag.current = {
      from: p,
      normal,
      index,
      base: { walls: storey.interiorWalls, openings: storey.openings },
    };
    lock(true);
    useEditorStore.getState().beginBatch();
    setDragging(true);
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current) return;
    e.stopPropagation();
    const p = pointOnLevel(e, y + LIFT);
    if (!p) return;
    const delta = cm(dot(sub(p, current.from), current.normal));
    const moved = moveWall(current.index, delta, current.base, ctx);
    if (moved) {
      applyWallEdit(storeyId, moved);
      select({ kind: "interiorWall", storeyId, index: moved.index });
      setRefused(null);
    } else setRefused(p);
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (!drag.current) return;
    drag.current = null;
    lock(false);
    useEditorStore.getState().endBatch();
    setDragging(false);
    setRefused(null);
  };

  return (
    <>
      <HitStrip
        a={add(segment.a, scale(dir, range[0]))}
        b={add(segment.a, scale(dir, range[1]))}
        y={0}
        width={width}
        onClick={onClick}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        hover={{
          onPointerOver: (e) => {
            setOver(true);
            hover.onPointerOver(e);
          },
          onPointerOut: () => {
            setOver(false);
            hover.onPointerOut();
          },
        }}
        renderOrder={10}
      />
      {refused && dragging && (
        <Cross at={[refused.x, 0, refused.y]} size={cross} color={scene.mark} />
      )}
    </>
  );
}
