import { useContext, useMemo, useRef } from "react";
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
import { useGhost } from "./ghost";
import { PictureMode, useHover, useMarked } from "./hover";
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
  const marked = useMarked(target);
  const { selected } = marked;
  // Lit while its row in the layers tree is hovered, on every storey (not in the card picture).
  const picture = useContext(PictureMode);
  const lit = useEditorStore((s) => !picture && s.highlightedWall === wall.index);
  const { hovered } = marked;
  const facadeColor = useEditorStore((s) => s.building.facadeColor);
  const remoteColor = useEditorStore(
    (s) => s.presence.find((p) => sameSelection(p.selection, target))?.color ?? null,
  );
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const addOpening = useEditorStore((s) => s.addOpening);
  const hover = useHover(target, active);
  const ghost = useGhost(display, ghostOpacity);
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

  // Every wall takes the facade colour from the photo; a shared wall stays grey only while
  // there is none.
  const color =
    selected || lit
      ? colors.accent
      : (remoteColor ??
        (hovered ? colors.wallHover : (facadeColor ?? (shared ? colors.wallShared : colors.wall))));

  // A lit wall shows solid even on a storey drawn as an outline, so the whole facade lights up.
  if (display === "outline" && !lit)
    return <Outline geometry={geometry} position={[0, elevation, 0]} />;
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
        color={lit ? color : ghost(color)}
        emissive={selected || lit ? colors.accent : (remoteColor ?? "#000000")}
        emissiveIntensity={selected || lit ? 0.35 : remoteColor ? 0.25 : 0}
        roughness={0.9}
      />
    </mesh>
  );
}
