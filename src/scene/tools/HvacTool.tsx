import { useEffect, useState } from "react";
import { Line } from "../Line";
import type { ThreeEvent } from "@react-three/fiber";
import { suggestHeatPumpPower } from "@/geometry/hvac";
import { bounds, equals, pointInPolygon, snapPoint } from "@/geometry/polygon";
import { GRID_SIZE } from "@/geometry/types";
import type { Vec2 } from "@/geometry/types";
import { useEditorStore } from "@/store/building";
import { storeyElevation } from "@/store/selectors";
import { pointOnLevel } from "./plane";
import { useSceneColors } from "../useSceneColors";

/**
 * Heating tool: a click on the ground outside the footprint places a heat pump,
 * a click inside starts or extends a pipe run (Escape ends it). Radiators are
 * placed by the wall's own click handler when this tool is active.
 */
export function HvacTool() {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const addHeatPump = useEditorStore((s) => s.addHeatPump);
  const addPipe = useEditorStore((s) => s.addPipe);
  const select = useEditorStore((s) => s.select);
  const scene = useSceneColors();
  const [run, setRun] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (run.length >= 2 && activeStoreyId) {
        const id = addPipe(activeStoreyId, run);
        select({ kind: "pipe", storeyId: activeStoreyId, id });
      }
      setRun([]);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [run, activeStoreyId, addPipe, select]);

  if (!activeStoreyId) return null;
  const elevation = storeyElevation(building, activeStoreyId);
  const { min, max } = bounds(building.footprint);
  const size = Math.max(max.x - min.x, max.y - min.y) + 40;
  const centre: [number, number, number] = [
    (min.x + max.x) / 2,
    elevation + 0.01,
    (min.y + max.y) / 2,
  ];

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    const hit = pointOnLevel(e, elevation);
    if (!hit) return;
    const p = snapPoint(hit, GRID_SIZE);
    if (pointInPolygon(p, building.footprint)) {
      e.stopPropagation();
      const last = run[run.length - 1];
      if (!last || !equals(last, p)) setRun([...run, p]);
      return;
    }
    if (elevation > 0) return; // heat pumps stand on the ground
    e.stopPropagation();
    const id = addHeatPump({ position: p, power: suggestHeatPumpPower(building), kind: "air" });
    select({ kind: "heatPump", id });
  };

  const y = elevation + 0.06;
  const preview = cursor && run.length > 0 ? [...run, cursor] : run;
  return (
    <group>
      <mesh
        position={centre}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          const hit = pointOnLevel(e, elevation);
          setCursor(hit ? snapPoint(hit, GRID_SIZE) : null);
        }}
        onClick={onClick}
      >
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {preview.length >= 2 && (
        <Line
          points={preview.map((p) => [p.x, y, p.y] as [number, number, number])}
          color={scene.mark}
          lineWidth={3}
          dashed
          dashSize={0.3}
          gapSize={0.15}
        />
      )}
      {cursor && (
        <mesh position={[cursor.x, y, cursor.y]}>
          <sphereGeometry args={[0.1, 10, 10]} />
          <meshBasicMaterial color={scene.mark} />
        </mesh>
      )}
    </group>
  );
}
