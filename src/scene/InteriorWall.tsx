import { useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { defaultOpening, snapOffset } from "@/geometry/openings";
import { dot, sub } from "@/geometry/polygon";
import { interiorWallAsWall, wallSolids } from "@/geometry/walls";
import type { Id, Opening, Segment } from "@/geometry/types";
import { colors } from "@/lib/colors";
import type { StoreyDisplay } from "./display";
import { useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { useGhost } from "./ghost";
import { useHover, useMarked } from "./hover";
import { mergeAll, meshRaycast, noRaycast, prismGeometry, worldToPlan } from "./three";
import { useDisposableGeometry } from "./useDisposableGeometry";

interface Props {
  storeyId: Id;
  index: number;
  segment: Segment;
  openings: readonly Opening[];
  height: number;
  /** Metres, from the wall's type. */
  thickness: number;
  /** Where the wall is built, metres along it (wallGraph.pieceRange). */
  range: [number, number];
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}

/** A thin wall inside the footprint, with holes for its openings. Clicking it with the Window or Door tool adds one. */
export function InteriorWall({
  storeyId,
  index,
  segment,
  openings,
  height,
  thickness,
  range,
  elevation,
  active,
  display,
  ghostOpacity,
}: Props) {
  const target: Selection = useMemo(
    () => ({ kind: "interiorWall", storeyId, index }),
    [storeyId, index],
  );
  const { selected, hovered } = useMarked(target);
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const addOpening = useEditorStore((s) => s.addOpening);
  const hover = useHover(target, active);
  const ghost = useGhost(display, ghostOpacity);

  const wall = useMemo(
    () => interiorWallAsWall(segment, index, height, thickness),
    [segment, index, height, thickness],
  );
  const hash = JSON.stringify([segment, height, thickness, openings, range]);
  const geometry = useMemo(() => {
    const prisms = wallSolids(wall, openings, range);
    return mergeAll(prisms.map((p) => prismGeometry(p.plan, p.bottom, p.top)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  useDisposableGeometry(geometry);

  // Same press-and-release bookkeeping as the exterior wall.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!active || e.button !== 0) return;
    down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const start = down.current;
    down.current = null;
    if (!start || !active || e.button !== 0) return;
    if (Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y) > 6) return;
    if (tool === "window" || tool === "door") {
      e.stopPropagation();
      // Shift places the other kind.
      const kind = e.nativeEvent.shiftKey ? (tool === "door" ? "window" : "door") : tool;
      const defaults = defaultOpening(kind);
      const u = dot(sub(worldToPlan(e.point), wall.outerA), wall.direction);
      const offset = snapOffset(u - defaults.width / 2, defaults.width, wall.length);
      const id = addOpening(storeyId, {
        ...defaults,
        wallIndex: index,
        interior: true,
        offset,
      });
      select({ kind: "opening", storeyId, id });
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      select(target);
    }
  };

  // A piece too short to show (an inverted range) or a door filling it leaves no solid.
  if (display === "outline" || !geometry) return null;
  return (
    <mesh
      geometry={geometry}
      position={[0, elevation, 0]}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        down.current = null;
      }}
      raycast={active && tool !== "interiorWall" ? meshRaycast : noRaycast}

      {...hover}
    >
      <meshStandardMaterial
        color={ghost(selected ? colors.accent : hovered ? colors.wallHover : colors.interiorWall)}
        emissive={selected ? colors.accent : "#000000"}
        emissiveIntensity={selected ? 0.35 : 0}
        roughness={0.9}
      />
    </mesh>
  );
}
