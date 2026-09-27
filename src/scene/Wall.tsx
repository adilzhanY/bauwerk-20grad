import { useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { defaultOpening, snapOffset } from "@/geometry/openings";
import { dot, sub } from "@/geometry/polygon";
import { wallSolids } from "@/geometry/walls";
import type { Wall as WallData } from "@/geometry/walls";
import type { Id, Opening } from "@/geometry/types";
import { colors } from "@/lib/colors";
import { Outline } from "./Outline";
import type { StoreyDisplay } from "./display";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { useHover } from "./hover";
import { mergeAll, meshRaycast, noRaycast, prismGeometry, worldToPlan } from "./three";
import { placeRadiatorFromWallClick } from "./tools/placeRadiator";
import { useDisposableGeometry } from "./useDisposableGeometry";

interface Props {
  storeyId: Id;
  wall: WallData;
  openings: readonly Opening[];
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}

export function Wall({
  storeyId,
  wall,
  openings,
  elevation,
  active,
  display,
  ghostOpacity,
}: Props) {
  const target: Selection = useMemo(
    () => ({ kind: "wall", storeyId, wallIndex: wall.index }),
    [storeyId, wall.index],
  );
  const selected = useEditorStore((s) => sameSelection(s.selection, target));
  const hovered = useEditorStore((s) => sameSelection(s.hovered, target));
  const remoteColor = useEditorStore(
    (s) => s.presence.find((p) => sameSelection(p.selection, target))?.color ?? null,
  );
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const addOpening = useEditorStore((s) => s.addOpening);
  const hover = useHover(target, active);
  const shared = useEditorStore((s) => (s.building.sharedEdges ?? []).includes(wall.index));

  // Memoised by a hash of the inputs: the wall quad, height and the openings on it.
  const hash = JSON.stringify([wall.quad, wall.height, openings]);
  const geometry = useMemo(() => {
    const prisms = wallSolids(wall, openings);
    return mergeAll(prisms.map((p) => prismGeometry(p.plan, p.bottom, p.top)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  useDisposableGeometry(geometry);

  // Place on pointer up after a short pointer down on the same wall. R3F's synthetic
  // click only fires for objects hit at pointer down and can be lost to a stale
  // pointer capture, so the wall keeps its own bookkeeping.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    const start = down.current;
    down.current = null;
    if (!start || e.button !== 0) return;
    const moved = Math.hypot(e.nativeEvent.clientX - start.x, e.nativeEvent.clientY - start.y);
    if (moved > 6) return;
    act(e);
  };
  const act = (e: ThreeEvent<PointerEvent>) => {
    if (!active) return;
    if (tool === "opening") {
      e.stopPropagation();
      const kind = e.nativeEvent.shiftKey ? "door" : "window";
      const defaults = defaultOpening(kind);
      const u = dot(sub(worldToPlan(e.point), wall.outerA), wall.direction);
      const offset = snapOffset(u - defaults.width / 2, defaults.width, wall.length);
      const id = addOpening(storeyId, { ...defaults, wallIndex: wall.index, offset });
      select({ kind: "opening", storeyId, id });
      return;
    }
    if (tool === "hvac") {
      e.stopPropagation();
      placeRadiatorFromWallClick(worldToPlan(e.point), wall.index);
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      select(target);
    }
  };

  const color = selected
    ? colors.accent
    : (remoteColor ?? (hovered ? colors.wallHover : shared ? colors.wallShared : colors.wall));

  if (display === "outline") return <Outline geometry={geometry} position={[0, elevation, 0]} />;
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
      castShadow
      receiveShadow
      {...hover}
    >
      <meshStandardMaterial
        color={color}
        emissive={selected ? colors.accent : (remoteColor ?? "#000000")}
        emissiveIntensity={selected ? 0.35 : remoteColor ? 0.25 : 0}
        roughness={0.9}
        transparent={display === "ghost"}
        opacity={display === "ghost" ? ghostOpacity : 1}
        depthWrite={display !== "ghost"}
      />
    </mesh>
  );
}
