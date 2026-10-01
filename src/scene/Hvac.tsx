import { useMemo } from "react";
import { Line } from "./Line";
import type { ThreeEvent } from "@react-three/fiber";
import { edges } from "@/geometry/polygon";
import { effectiveWallThickness } from "@/geometry/layers";
import type { Building, HeatPump, Storey } from "@/geometry/types";
import { colors } from "@/lib/colors";
import { useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { useGhost } from "./ghost";
import { useHover, useMarked } from "./hover";
import { lineRaycast, meshRaycast, noRaycast, yawFor } from "./three";
import { useSceneColors } from "./useSceneColors";
import type { StoreyDisplay } from "./display";

const RADIATOR_COLOR = "#e9e9e6";
const PUMP_COLOR = "#9aa3ad";
const RADIATOR_DEPTH = 0.1;
const EMPTY_PUMPS: HeatPump[] = [];

function useSelect(target: Selection, active: boolean) {
  const { selected, hovered } = useMarked(target);
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const hover = useHover(target, active);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!active || e.delta > 6 || (tool !== "select" && tool !== "hvac")) return;
    e.stopPropagation();
    select(target);
  };
  return { selected, hovered, onClick, hover };
}

/** Radiators and pipe runs of one storey. */
export function StoreyHvac({
  building,
  storey,
  elevation,
  active,
  display,
  ghostOpacity,
}: {
  building: Building;
  storey: Storey;
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}) {
  const es = useMemo(() => edges(building.footprint), [building.footprint]);
  const thickness = effectiveWallThickness(building);
  if (display === "outline") return null;
  return (
    <group>
      {(storey.radiators ?? []).map((r) => {
        const e = es[r.wallIndex];
        if (!e) return null;
        return (
          <RadiatorMesh
            key={r.id}
            storeyId={storey.id}
            id={r.id}
            edge={e}
            thickness={thickness}
            elevation={elevation}
            active={active}
            display={display}
            ghostOpacity={ghostOpacity}
            offset={r.offset}
            width={r.width}
            height={r.height}
          />
        );
      })}
      {(storey.pipes ?? []).map((p) => (
        <PipeLine
          key={p.id}
          storeyId={storey.id}
          id={p.id}
          points={p.points}
          elevation={elevation}
          active={active}
          display={display}
          ghostOpacity={ghostOpacity}
        />
      ))}
    </group>
  );
}

function RadiatorMesh(props: {
  storeyId: string;
  id: string;
  edge: ReturnType<typeof edges>[number];
  thickness: number;
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
  offset: number;
  width: number;
  height: number;
}) {
  const { edge, thickness, elevation, active, display, ghostOpacity, offset, width, height } =
    props;
  const ghost = useGhost(display, ghostOpacity);
  const target: Selection = useMemo(
    () => ({ kind: "radiator", storeyId: props.storeyId, id: props.id }),
    [props.storeyId, props.id],
  );
  const { selected, hovered, onClick, hover } = useSelect(target, active);
  const u = offset + width / 2;
  const depth = thickness + RADIATOR_DEPTH / 2 + 0.01;
  const cx = edge.a.x + edge.direction.x * u - edge.normal.x * depth;
  const cz = edge.a.y + edge.direction.y * u - edge.normal.y * depth;
  return (
    <mesh
      position={[cx, elevation + 0.15 + height / 2, cz]}
      rotation={[0, yawFor(edge.direction), 0]}
      onClick={onClick}
      raycast={active ? meshRaycast : noRaycast}

      {...hover}
    >
      <boxGeometry args={[width, height, RADIATOR_DEPTH]} />
      <meshStandardMaterial
        color={ghost(selected ? colors.accent : hovered ? "#ffffff" : RADIATOR_COLOR)}
        emissive={selected ? colors.accent : "#000000"}
        emissiveIntensity={selected ? 0.3 : 0}
        roughness={0.4}
        metalness={0.3}
      />
    </mesh>
  );
}

function PipeLine(props: {
  storeyId: string;
  id: string;
  points: { x: number; y: number }[];
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}) {
  const target: Selection = useMemo(
    () => ({ kind: "pipe", storeyId: props.storeyId, id: props.id }),
    [props.storeyId, props.id],
  );
  const { selected, hovered, onClick, hover } = useSelect(target, props.active);
  const scene = useSceneColors();
  const y = props.elevation + 0.05;
  return (
    <Line
      points={props.points.map((p) => [p.x, y, p.y] as [number, number, number])}
      color={selected ? scene.select : hovered ? scene.ink : "#c0392b"}
      lineWidth={selected ? 4 : 3}
      transparent={props.display === "ghost"}
      opacity={props.display === "ghost" ? props.ghostOpacity : 1}
      onClick={onClick}
      raycast={props.active ? lineRaycast : noRaycast}
      {...hover}
    />
  );
}

/** Heat pumps stand on the ground outside the footprint. */
export function HeatPumps() {
  // Select the stored array itself; a `?? []` fallback inside the selector would make a new
  // array on every read and send useSyncExternalStore into an endless re-render.
  const stored = useEditorStore((s) => s.building.heatPumps);
  const pumps = stored ?? EMPTY_PUMPS;
  return (
    <group>
      {pumps.map((p) => (
        <HeatPumpMesh key={p.id} id={p.id} x={p.position.x} y={p.position.y} kind={p.kind} />
      ))}
    </group>
  );
}

function HeatPumpMesh({
  id,
  x,
  y,
  kind,
}: {
  id: string;
  x: number;
  y: number;
  kind: "air" | "ground";
}) {
  const target: Selection = useMemo(() => ({ kind: "heatPump", id }), [id]);
  const { selected, hovered, onClick, hover } = useSelect(target, true);
  const h = kind === "air" ? 1.3 : 0.9;
  return (
    <mesh position={[x, h / 2, y]} onClick={onClick} {...hover}>
      <boxGeometry args={[1.0, h, 0.4]} />
      <meshStandardMaterial
        color={selected ? colors.accent : hovered ? "#b3bcc6" : PUMP_COLOR}
        emissive={selected ? colors.accent : "#000000"}
        emissiveIntensity={selected ? 0.3 : 0}
        roughness={0.5}
        metalness={0.4}
      />
    </mesh>
  );
}
