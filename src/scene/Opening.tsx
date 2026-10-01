import { useMemo, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Wall } from "@/geometry/walls";
import type { Id, Opening as OpeningData } from "@/geometry/types";
import { colors } from "@/lib/colors";
import type { StoreyDisplay } from "./display";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { useGhost } from "./ghost";
import { useHover, useMarked } from "./hover";
import { yawFor } from "./three";
import { pointOnVertical } from "./tools/plane";
import { useDragLock } from "./tools/useDragLock";
import { snapOffset } from "@/geometry/openings";
import { dot, sub } from "@/geometry/polygon";
import { meshRaycast, noRaycast } from "./three";
import { shareDrag } from "@/sync/presence";

interface Props {
  storeyId: Id;
  wall: Wall;
  opening: OpeningData;
  thickness: number;
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
  valid: boolean;
}

/** A translucent pane for windows and a slab for doors, sitting inside the wall hole. */
export function Opening({
  storeyId,
  wall,
  opening,
  thickness,
  elevation,
  active,
  display,
  ghostOpacity,
  valid,
}: Props) {
  const target: Selection = useMemo(
    () => ({ kind: "opening", storeyId, id: opening.id }),
    [storeyId, opening.id],
  );
  const { selected, hovered } = useMarked(target);
  const remoteColor = useEditorStore(
    (s) => s.presence.find((p) => sameSelection(p.selection, target))?.color ?? null,
  );
  // Someone else is dragging this opening: follow their drag live and keep hands off.
  const remoteDrag = useEditorStore((s) =>
    s.presence.find((p) => p.dragging?.id === opening.id && p.dragging.storeyId === storeyId),
  );
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const updateOpening = useEditorStore((s) => s.updateOpening);
  const hover = useHover(target, active);
  const lock = useDragLock();
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  const offset = dragOffset ?? remoteDrag?.dragging?.offset ?? opening.offset;
  const u = offset + opening.width / 2;
  const depth = thickness / 2;
  const cx = wall.outerA.x + wall.direction.x * u - wall.normal.x * depth;
  const cz = wall.outerA.y + wall.direction.y * u - wall.normal.y * depth;
  const cy = elevation + opening.sill + opening.height / 2;
  const yaw = yawFor(wall.direction);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    if (!active) return;
    e.stopPropagation();
    select(target);
  };

  const draggable = active && (tool === "select" || tool === "opening") && !remoteDrag;

  const offsetAt = (e: ThreeEvent<PointerEvent>): number | null => {
    const hit = pointOnVertical(e, wall.outerA, wall.normal);
    if (!hit) return null;
    const along = dot(sub(hit, wall.outerA), wall.direction);
    return snapOffset(along - opening.width / 2, opening.width, wall.length);
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!draggable || e.button !== 0) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    lock(true);
    select(target);
    setDragOffset(opening.offset);
    shareDrag({ storeyId, id: opening.id, offset: opening.offset });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (dragOffset === null) return;
    const next = offsetAt(e);
    if (next === null) return;
    setDragOffset(next);
    shareDrag({ storeyId, id: opening.id, offset: next });
  };

  const finishDrag = (e: ThreeEvent<PointerEvent>, commit: boolean) => {
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (dragOffset === null) return;
    lock(false);
    if (commit && dragOffset !== opening.offset) {
      updateOpening(storeyId, opening.id, { offset: dragOffset });
    }
    // After the commit, so the others get the move before the drag ends and never see the
    // opening jump back for a moment.
    shareDrag(null);
    setDragOffset(null);
  };

  const base = opening.kind === "door" ? colors.door : colors.window;
  const color = !valid
    ? colors.warning
    : selected
      ? colors.accent
      : (remoteDrag?.color ?? remoteColor ?? base);
  const ghost = useGhost(display, ghostOpacity);
  // Glass is see-through on the storey being edited; on a ghost storey it is opaque like
  // everything else there (ghost.ts).
  const opacity = display !== "ghost" && opening.kind === "window" ? 0.55 : 1;
  if (display === "outline") return null;

  return (
    <mesh
      position={[cx, cy, cz]}
      rotation={[0, yaw, 0]}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        finishDrag(e, true);
      }}
      onPointerCancel={(e) => {
        finishDrag(e, false);
      }}
      raycast={active ? meshRaycast : noRaycast}
      {...hover}
    >
      {opening.kind === "door" ? (
        <boxGeometry args={[opening.width, opening.height, Math.max(thickness * 0.5, 0.04)]} />
      ) : (
        <boxGeometry args={[opening.width, opening.height, 0.03]} />
      )}
      <meshStandardMaterial
        color={ghost(color)}
        emissive={selected || hovered ? colors.accent : "#000000"}
        emissiveIntensity={selected ? 0.4 : hovered ? 0.15 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
        roughness={opening.kind === "door" ? 0.8 : 0.2}
        metalness={opening.kind === "door" ? 0 : 0.1}
      />
    </mesh>
  );
}
