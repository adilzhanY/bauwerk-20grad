import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreeElements, ThreeEvent } from "@react-three/fiber";
import { Shape, ShapeGeometry, Vector2 } from "three";
import { dragOpening, openingsOn } from "@/geometry/openings";
import type { OpeningGrip } from "@/geometry/openings";
import { add, dot, scale, sub } from "@/geometry/polygon";
import type { Id, Opening, Vec2 } from "@/geometry/types";
import type { Wall } from "@/geometry/walls";
import { useEditorStore } from "@/store/building";
import { pointOnLevel } from "./tools/plane";
import { useDisposableGeometry } from "./useDisposableGeometry";
import { useDragLock } from "./tools/useDragLock";
import { useCanvasCursor } from "./useCanvasCursor";
import { useSceneColors } from "./useSceneColors";

export interface PlanHandle {
  wall: Wall;
  interior: boolean;
  opening: Opening;
  /** Metres out from the wall to the opening's dimension line, where its arrows sit. */
  chainOffset: number;
}

/** Screen radius of the grip on an arrow, px. */
const GRIP_PX = 10;
/** Above the drawing, so the grips take the pointer before anything drawn under them. */
const GRIP_LIFT = 0.03;

interface Drag {
  handle: PlanHandle;
  grip: OpeningGrip;
  /** For a move: where along the wall the pointer took hold, minus the opening's offset. */
  grab: number;
}

/**
 * The grips of the floor plan: each opening can be dragged along its wall, and each end of
 * its dimension, the arrow, drags that edge of the opening. The store is updated on every
 * move inside one undo step, so the drawing, the dimensions and the 3D model follow live.
 */
export function PlanHandles({
  storeyId,
  handles,
  y,
  zoom,
}: {
  storeyId: Id;
  handles: PlanHandle[];
  /** Height of the drawing in world space. */
  y: number;
  zoom: number;
}) {
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const scene = useSceneColors();
  const lock = useDragLock();
  const drag = useRef<Drag | null>(null);
  const editable = tool === "select" || tool === "opening";
  const [cursor, setCursor] = useState<string | null>(null);
  useCanvasCursor(cursor);

  // A drag whose grips go away before the pointer is released (the opening was deleted, undone
  // or removed by someone else, or this view unmounted) gets no pointer up: close its undo
  // step and give the camera back here, or every later edit folds into that step.
  useEffect(() => {
    const current = drag.current;
    if (!current || handles.some((h) => h.opening.id === current.handle.opening.id)) return;
    drag.current = null;
    lock(false);
    useEditorStore.getState().endBatch();
  }, [handles, lock]);
  useEffect(
    () => () => {
      if (drag.current) useEditorStore.getState().endBatch();
      drag.current = null;
    },
    [],
  );

  if (!editable) return null;
  const radius = GRIP_PX / Math.max(zoom, 1e-6);

  const along = (e: ThreeEvent<PointerEvent>, wall: Wall): number | null => {
    const p = pointOnLevel(e, y + GRIP_LIFT);
    return p ? dot(sub(p, wall.outerA), wall.direction) : null;
  };

  const start = (e: ThreeEvent<PointerEvent>, handle: PlanHandle, grip: OpeningGrip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const state = useEditorStore.getState();
    state.select({ kind: "opening", storeyId, id: handle.opening.id });
    const u = along(e, handle.wall) ?? handle.opening.offset;
    drag.current = { handle, grip, grab: grip === "move" ? u - handle.opening.offset : 0 };
    lock(true);
    state.beginBatch();
    setCursor(grip === "move" ? "move" : resizeCursor(handle.wall));
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current) return;
    e.stopPropagation();
    const u = along(e, current.handle.wall);
    if (u === null) return;
    const state = useEditorStore.getState();
    const storey = state.building.storeys.find((s) => s.id === storeyId);
    const opening = storey?.openings.find((o) => o.id === current.handle.opening.id);
    if (!storey || !opening) return;
    const siblings = openingsOn(
      storey.openings,
      current.handle.wall.index,
      current.handle.interior,
    );
    const next = dragOpening(
      opening,
      siblings,
      current.handle.wall.length,
      current.grip,
      u - current.grab,
    );
    if (next.offset !== opening.offset || next.width !== opening.width) {
      state.updateOpening(storeyId, opening.id, next);
    }
  };

  const end = (e: ThreeEvent<PointerEvent>) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (!drag.current) return;
    drag.current = null;
    lock(false);
    useEditorStore.getState().endBatch();
    setCursor(null);
  };

  const pointer = (cursor: string) => ({
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
    },
    onPointerOver: () => {
      if (!drag.current) setCursor(cursor);
    },
    onPointerOut: () => {
      if (!drag.current) setCursor(null);
    },
  });

  return (
    <group position={[0, GRIP_LIFT, 0]}>
      {handles.map((handle) => {
        const { wall, opening, chainOffset } = handle;
        const at = (u: number, out: number) =>
          add(add(wall.outerA, scale(wall.direction, u)), scale(wall.normal, out));
        const thickness = dot(sub(wall.outerA, wall.innerA), wall.normal);
        const u0 = opening.offset;
        const u1 = opening.offset + opening.width;
        const selected = selection?.kind === "opening" && selection.id === opening.id;
        return (
          <group key={opening.id}>
            <HitArea
              polygon={[at(u0, 0), at(u1, 0), at(u1, -thickness), at(u0, -thickness)]}
              onPointerDown={(e) => {
                start(e, handle, "move");
              }}
              {...pointer("move")}
            />
            {(["start", "end"] as const).map((grip) => {
              const p = at(grip === "start" ? u0 : u1, chainOffset);
              return (
                <mesh
                  key={grip}
                  position={[p.x, 0, p.y]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={20}
                  onPointerDown={(e) => {
                    start(e, handle, grip);
                  }}
                  {...pointer(resizeCursor(wall))}
                >
                  <circleGeometry args={[radius, 20]} />
                  {/* Visible on the opening being edited, invisible but grabbable elsewhere. */}
                  <meshBasicMaterial
                    color={scene.select}
                    transparent
                    opacity={selected ? 0.25 : 0}
                    depthTest={false}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

/** The resize cursor that runs along the wall on screen. */
function resizeCursor(wall: Wall): string {
  return Math.abs(wall.direction.x) >= Math.abs(wall.direction.y) ? "ew-resize" : "ns-resize";
}

/** An invisible polygon that takes the pointer. */
function HitArea({
  polygon,
  ...events
}: { polygon: Vec2[] } & Omit<ThreeElements["mesh"], "geometry">) {
  const geometry = useMemo(() => {
    // Drawn in XY and laid flat by the rotation, which turns y into -z, as in PlanDrawing.
    return new ShapeGeometry(new Shape(polygon.map((p) => new Vector2(p.x, -p.y))));
  }, [polygon]);
  useDisposableGeometry(geometry);
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} renderOrder={20} {...events}>
      <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  );
}
