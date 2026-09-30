import { useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { effectiveWallThickness } from "@/geometry/layers";
import { bounds } from "@/geometry/polygon";
import type { Vec2 } from "@/geometry/types";
import { interiorWallThickness } from "@/geometry/constructions";
import { drawWallTo, snapToWall } from "@/geometry/wallDrawing";
import type { WallContext, WallSnap } from "@/geometry/wallDrawing";
import { colors } from "@/lib/colors";
import { formatBaumass } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { storeyElevation } from "@/store/selectors";
import { Line } from "../Line";
import { Cross, Dot, MARKS_ON_TOP } from "../Marks";
import { noRaycast } from "../three";
import { pointOnLevel } from "./plane";

/** How close to a wall's face the pointer snaps onto it, screen pixels (in the plan view). */
const SNAP_PX = 16;
/** The same in the 3D view, metres, where the screen scale changes with the distance. */
const SNAP_3D_M = 0.35;
/** The dot, screen pixels in the plan view, metres in 3D. */
const DOT_PX = 6;
const DOT_3D_M = 0.1;

/**
 * Draws an interior wall: start on a wall, and the wall runs towards the pointer to the next
 * wall it meets (geometry/wallDrawing.ts). The dot slides along the face of the wall under
 * the pointer, the inner face of an exterior wall or a face of an interior wall, to the
 * centimetre. Near a right angle the wall locks to it; its clear length shows as it is drawn.
 * Nothing starts off a wall, and nothing ends in the air. Escape cancels.
 */
export function InteriorWallTool() {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const planView = useEditorStore((s) => s.planView);
  const language = useEditorStore((s) => s.language);
  const addInteriorWall = useEditorStore((s) => s.addInteriorWall);
  const camera = useThree((s) => s.camera);
  const [start, setStart] = useState<WallSnap | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStart(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const storey = building.storeys.find((s) => s.id === activeStoreyId);
  const ctx: WallContext | null = useMemo(
    () =>
      storey
        ? {
            footprint: building.footprint,
            walls: storey.interiorWalls,
            openings: storey.openings,
            exteriorThickness: effectiveWallThickness(building),
            thicknessOf: interiorWallThickness(building.constructions),
          }
        : null,
    [building, storey],
  );
  if (!storey || !ctx) return null;

  const elevation = storeyElevation(building, storey.id);
  // The plan view draws its plan over the storey; the tool goes on top of it there.
  const y = planView ? elevation + storey.height + 0.1 : elevation + 0.05;
  const zoom = "isOrthographicCamera" in camera && planView ? camera.zoom : null;
  const radius = zoom ? SNAP_PX / zoom : SNAP_3D_M;
  const dot = zoom ? DOT_PX / zoom : DOT_3D_M;

  const hover = cursor && !start ? snapToWall(cursor, ctx, radius) : null;
  const draft = cursor && start ? drawWallTo(start, cursor, ctx) : null;

  const { min, max } = bounds(building.footprint);
  const size = Math.max(max.x - min.x, max.y - min.y) + 4;
  const centre: [number, number, number] = [
    (min.x + max.x) / 2,
    elevation + 0.01,
    (min.y + max.y) / 2,
  ];

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    setCursor(pointOnLevel(e, elevation));
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const p = pointOnLevel(e, elevation);
    if (!p) return;
    if (!start) {
      // A wall starts on a wall, never in the open.
      // Nor on a window or door.
      const snap = snapToWall(p, ctx, radius);
      if (snap && !snap.blocked) setStart(snap);
      return;
    }
    const wall = drawWallTo(start, p, ctx);
    if (!wall || wall.blocked) return;
    addInteriorWall(storey.id, wall.segment);
    setStart(null);
  };

  const at = (p: Vec2): [number, number, number] => [p.x, y, p.y];
  const middle = draft && {
    x: (draft.clear[0].x + draft.clear[1].x) / 2,
    y: (draft.clear[0].y + draft.clear[1].y) / 2,
  };

  return (
    <group>
      <mesh
        position={centre}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={onMove}
        onClick={onClick}
        onPointerOut={() => {
          setCursor(null);
        }}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Before the first click: the dot on the wall under the pointer, or a faint ring
          where there is no wall to start on. */}
      {!start && hover && !hover.blocked && (
        <Dot at={at(hover.shown)} radius={dot} color={colors.accent} />
      )}
      {/* On a window or door: a red cross, since no wall can meet another there. */}
      {!start && hover?.blocked && <Cross at={at(hover.shown)} size={dot} color={colors.warning} />}
      {!start && !hover && cursor && (
        <Dot at={at(cursor)} radius={dot} color={colors.storeyLine} ring />
      )}

      {start && <Dot at={at(start.shown)} radius={dot} color={colors.accent} />}
      {start && draft && middle && (
        <>
          <Line
            points={[at(draft.clear[0]), at(draft.clear[1])]}
            color={draft.blocked ? colors.warning : colors.accent}
            lineWidth={4}
            depthTest={false}
            renderOrder={MARKS_ON_TOP}
            raycast={noRaycast}
          />
          {draft.blocked ? (
            <Cross at={at(draft.end.shown)} size={dot} color={colors.warning} />
          ) : (
            <Dot at={at(draft.end.shown)} radius={dot} color={colors.accent} />
          )}
          <Html
            position={at(middle)}
            center
            zIndexRange={[20, 10]}
            style={{ pointerEvents: "none" }}
          >
            <span className="rounded-soft border border-select bg-paper px-1.5 py-px font-num text-xs whitespace-nowrap text-select shadow-soft select-none">
              {formatBaumass(draft.length, language)}
            </span>
          </Html>
        </>
      )}
      {/* After the first click, where no wall can run: a faint red line to the pointer. */}
      {start && !draft && cursor && (
        <Line
          points={[at(start.shown), at(cursor)]}
          color={colors.warning}
          lineWidth={1.5}
          dashed
          dashSize={0.15}
          gapSize={0.1}
          transparent
          opacity={0.7}
          depthTest={false}
          renderOrder={MARKS_ON_TOP}
          raycast={noRaycast}
        />
      )}
    </group>
  );
}
