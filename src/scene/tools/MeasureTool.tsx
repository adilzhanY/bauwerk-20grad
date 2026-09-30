import { useEffect, useMemo, useState } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { effectiveWallThickness } from "@/geometry/layers";
import { measurePoint } from "@/geometry/measuring";
import { bounds, distance, equals } from "@/geometry/polygon";
import type { Vec2 } from "@/geometry/types";
import { interiorWallThickness } from "@/geometry/constructions";
import type { WallContext } from "@/geometry/wallDrawing";
import { formatBaumass } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { storeyElevation } from "@/store/selectors";
import { Line } from "../Line";
import { Dot, MARKS_ON_TOP } from "../Marks";
import { noRaycast } from "../three";
import { useSceneColors } from "../useSceneColors";
import { pointOnLevel } from "./plane";

/** As the interior wall tool: screen pixels in the plan view, metres in 3D. */
const SNAP_PX = 16;
const SNAP_3D_M = 0.35;
const DOT_PX = 5;
const DOT_3D_M = 0.08;

/**
 * Measures a distance and keeps it: click where it starts and where it ends, anywhere, in or
 * around the building. Near a wall the point sits on the wall's face; a line close to the
 * building's directions locks straight (geometry/measuring.ts). The measurement stays on the
 * storey as a red line with its length, to select and delete later (Measurements.tsx).
 * Escape drops a started one.
 */
export function MeasureTool() {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const planView = useEditorStore((s) => s.planView);
  const language = useEditorStore((s) => s.language);
  const addMeasurement = useEditorStore((s) => s.addMeasurement);
  const camera = useThree((s) => s.camera);
  const scene = useSceneColors();
  const [start, setStart] = useState<Vec2 | null>(null);
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
            exteriorThickness: effectiveWallThickness(building),
            thicknessOf: interiorWallThickness(building.constructions),
          }
        : null,
    [building, storey],
  );
  if (!storey || !ctx) return null;

  const elevation = storeyElevation(building, storey.id);
  const y = planView ? elevation + storey.height + 0.1 : elevation + 0.06;
  const zoom = planView && "isOrthographicCamera" in camera ? camera.zoom : null;
  const radius = zoom ? SNAP_PX / zoom : SNAP_3D_M;
  const dot = zoom ? DOT_PX / zoom : DOT_3D_M;
  const point = cursor ? measurePoint(cursor, ctx, radius, start) : null;

  const { min, max } = bounds(building.footprint);
  // Well beyond the building: a distance may be measured to anything around it.
  const size = Math.max(max.x - min.x, max.y - min.y) + 80;
  const centre: [number, number, number] = [
    (min.x + max.x) / 2,
    elevation + 0.01,
    (min.y + max.y) / 2,
  ];

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const hit = pointOnLevel(e, elevation);
    if (!hit) return;
    const p = measurePoint(hit, ctx, radius, start);
    if (!start) {
      setStart(p);
      return;
    }
    if (!equals(start, p, 1e-6)) addMeasurement(storey.id, start, p);
    setStart(null);
  };

  const at = (p: Vec2): [number, number, number] => [p.x, y, p.y];

  return (
    <group>
      <mesh
        position={centre}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          setCursor(pointOnLevel(e, elevation));
        }}
        onPointerOut={() => {
          setCursor(null);
        }}
        onClick={onClick}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {point && <Dot at={at(point)} radius={dot} color={scene.mark} />}
      {start && <Dot at={at(start)} radius={dot} color={scene.mark} />}
      {start && point && !equals(start, point, 1e-6) && (
        <>
          <Line
            points={[at(start), at(point)]}
            color={scene.mark}
            lineWidth={2}
            depthTest={false}
            renderOrder={MARKS_ON_TOP}
            raycast={noRaycast}
          />
          <Html
            position={at({ x: (start.x + point.x) / 2, y: (start.y + point.y) / 2 })}
            center
            zIndexRange={[20, 10]}
            style={{ pointerEvents: "none" }}
          >
            <span className="rounded-soft border border-mark bg-paper px-1.5 py-px font-num text-xs whitespace-nowrap text-mark shadow-soft select-none">
              {formatBaumass(distance(start, point), language)}
            </span>
          </Html>
        </>
      )}
    </group>
  );
}
