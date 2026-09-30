import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { distance } from "@/geometry/polygon";
import type { Measurement, Vec2 } from "@/geometry/types";
import { formatBaumass } from "@/lib/format";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { storeyElevation } from "@/store/selectors";
import { useHover } from "./hover";
import { Line } from "./Line";
import { HitStrip } from "./HitStrip";
import { Dot, MARKS_ON_TOP } from "./Marks";
import { noRaycast } from "./three";
import { useSceneColors } from "./useSceneColors";

/** Screen pixels in the plan view; metres in 3D, where the screen scale changes with distance. */
const DOT_PX = 4;
const DOT_3D_M = 0.07;
const HIT_PX = 8;
const HIT_3D_M = 0.15;

/**
 * The distances kept on the active storey (the measure tool makes them): a red line with a
 * dot at each end and its length, drawn over everything so it reads in the plan and in 3D.
 * With the select tool a click on one selects it; Delete or the panel removes it.
 */
export function Measurements() {
  const storey = useEditorStore((s) => s.building.storeys.find((x) => x.id === s.activeStoreyId));
  const building = useEditorStore((s) => s.building);
  const planView = useEditorStore((s) => s.planView);
  const camera = useThree((s) => s.camera);
  if (!storey?.measurements?.length) return null;
  const elevation = storeyElevation(building, storey.id);
  // Above the floor plan drawing in the plan view, just above the floor in 3D.
  const y = planView ? elevation + storey.height + 0.1 : elevation + 0.06;
  const zoom = planView && "isOrthographicCamera" in camera ? camera.zoom : null;
  return (
    <group>
      {storey.measurements.map((m) => (
        <MeasurementLine
          key={m.id}
          storeyId={storey.id}
          measurement={m}
          y={y}
          dot={zoom ? DOT_PX / zoom : DOT_3D_M}
          hit={zoom ? HIT_PX / zoom : HIT_3D_M}
        />
      ))}
    </group>
  );
}

function MeasurementLine({
  storeyId,
  measurement,
  y,
  dot,
  hit,
}: {
  storeyId: string;
  measurement: Measurement;
  y: number;
  dot: number;
  hit: number;
}) {
  const target: Selection = useMemo(
    () => ({ kind: "measurement", storeyId, id: measurement.id }),
    [storeyId, measurement.id],
  );
  const selected = useEditorStore((s) => sameSelection(s.selection, target));
  const tool = useEditorStore((s) => s.tool);
  const language = useEditorStore((s) => s.language);
  const select = useEditorStore((s) => s.select);
  const scene = useSceneColors();
  const hover = useHover(target, tool === "select");
  const { a, b } = measurement;
  const at = (p: Vec2): [number, number, number] => [p.x, y, p.y];

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (tool !== "select" || e.delta > 4) return;
    e.stopPropagation();
    select(target);
  };

  return (
    <group>
      <Line
        points={[at(a), at(b)]}
        color={scene.mark}
        lineWidth={selected ? 3.5 : 2}
        depthTest={false}
        renderOrder={MARKS_ON_TOP}
        raycast={noRaycast}
      />
      <Dot at={at(a)} radius={selected ? dot * 1.5 : dot} color={scene.mark} />
      <Dot at={at(b)} radius={selected ? dot * 1.5 : dot} color={scene.mark} />
      {tool === "select" && (
        <HitStrip a={a} b={b} y={y} width={hit} onClick={onClick} hover={hover} />
      )}
      <Html
        position={at({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })}
        center
        zIndexRange={[20, 10]}
        style={{ pointerEvents: "none" }}
      >
        <span
          className={`rounded-soft border bg-paper px-1.5 py-px font-num text-xs whitespace-nowrap shadow-soft select-none ${
            selected ? "border-select text-select" : "border-mark text-mark"
          }`}
        >
          {formatBaumass(distance(a, b), language)}
        </span>
      </Html>
    </group>
  );
}
