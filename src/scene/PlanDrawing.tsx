import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { Shape, ShapeGeometry, Vector2 } from "three";
import { effectiveWallThickness } from "@/geometry/layers";
import { openingsOn } from "@/geometry/openings";
import { dimension, openingChain, openingSymbol, wallPoche } from "@/geometry/plan";
import type { Dimension, PlanLine } from "@/geometry/plan";
import { distance } from "@/geometry/polygon";
import type { Vec2 } from "@/geometry/types";
import { buildWalls, interiorWallAsWall } from "@/geometry/walls";
import { formatMetres } from "@/lib/format";
import { sameSelection, useEditorStore } from "@/store/building";
import { selectActiveStorey, storeyElevation } from "@/store/selectors";
import { noRaycast } from "./three";
import { useDisposableGeometry } from "./useDisposableGeometry";
import { useSceneColors } from "./useSceneColors";

/**
 * Screen sizes of the dimensioning, px: the chain of openings close to the wall, the overall
 * length further out, and the gaps and ticks. Converted to metres with the plan zoom, so the
 * drawing reads the same for a garden shed and an office block.
 */
const CHAIN_OFFSET_PX = 30;
const OVERALL_OFFSET_PX = 62;
const STYLE_PX = { gap: 6, overrun: 8, tick: 5 };
/** Chain pieces shorter than this on screen get no label, so the numbers never overlap. */
const MIN_LABELLED_PX = 34;
/** Drawn after everything else and through it: the plan is the top layer of the view. */
const ON_TOP = 10;

/**
 * The floor plan view as a drawing: every wall of the active storey cut and filled in ink
 * between its faces, windows and doors as breaks with their symbols in navy, and dimension
 * lines outside the building, the overall length and the chain of openings. It lies on top
 * of the storey and takes no clicks, so selecting and editing work through it as in 3D.
 */
export function PlanDrawing() {
  const building = useEditorStore((s) => s.building);
  const storey = useEditorStore(selectActiveStorey);
  const selection = useEditorStore((s) => s.selection);
  const language = useEditorStore((s) => s.language);
  const scene = useSceneColors();
  // Pixels per metre of the orthographic plan camera; 1 outside it.
  const zoom = useThree((s) => s.camera.zoom);
  const metres = (px: number) => px / Math.max(zoom, 1e-6);
  const zonesById = useMemo(() => new Map(building.zones.map((z) => [z.id, z])), [building.zones]);

  const drawing = useMemo(() => {
    if (!storey) return null;
    const thickness = effectiveWallThickness(building);
    const exterior = buildWalls(building.footprint, thickness, storey.height);
    const interior = storey.interiorWalls.map((segment, index) =>
      interiorWallAsWall(segment, index, storey.height),
    );
    const poche: { polygon: Vec2[]; selected: boolean }[] = [];
    const windows: PlanLine[] = [];
    const doors: PlanLine[] = [];
    const leaves: PlanLine[] = [];
    const arcs: PlanLine[] = [];
    const selectedOpenings: PlanLine[] = [];
    const overall: Dimension[] = [];
    const chain: Dimension[] = [];

    const drawWall = (wall: (typeof exterior)[number], isInterior: boolean) => {
      const openings = openingsOn(storey.openings, wall.index, isInterior);
      const wallSelected = isInterior
        ? sameSelection(selection, { kind: "interiorWall", storeyId: storey.id, index: wall.index })
        : sameSelection(selection, { kind: "wall", storeyId: storey.id, wallIndex: wall.index });
      for (const polygon of wallPoche(wall, openings))
        poche.push({ polygon, selected: wallSelected });
      for (const opening of openings) {
        const symbol = openingSymbol(wall, opening);
        const all = [...symbol.jambs, ...symbol.lines];
        if (sameSelection(selection, { kind: "opening", storeyId: storey.id, id: opening.id })) {
          selectedOpenings.push(...all, ...(symbol.leaf ? [symbol.leaf] : []));
        }
        if (opening.kind === "window") windows.push(...all);
        else doors.push(...all);
        if (symbol.leaf) leaves.push(symbol.leaf);
        for (let i = 0; i + 1 < symbol.arc.length; i++) {
          const a = symbol.arc[i];
          const b = symbol.arc[i + 1];
          if (a && b) arcs.push([a, b]);
        }
      }
      if (!isInterior) {
        const style = {
          gap: metres(STYLE_PX.gap),
          overrun: metres(STYLE_PX.overrun),
          tick: metres(STYLE_PX.tick),
        };
        overall.push(
          dimension(wall.outerA, wall.outerB, wall.normal, metres(OVERALL_OFFSET_PX), style),
        );
        chain.push(...openingChain(wall, openings, metres(CHAIN_OFFSET_PX), style));
      }
    };
    for (const wall of exterior) drawWall(wall, false);
    for (const wall of interior) drawWall(wall, true);
    return { poche, windows, doors, leaves, arcs, selectedOpenings, overall, chain, interior };
    // `metres` only reads the zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, storey, selection, zoom]);

  if (!storey || !drawing) return null;
  const y = storeyElevation(building, storey.id) + storey.height + 0.05;
  const dims = [...drawing.overall, ...drawing.chain];

  return (
    <group position={[0, y, 0]}>
      {/* A white sheet under the drawing, so the 3D storey below does not show through; rooms
          keep their zone colour on it, lightly. */}
      <Fill polygon={building.footprint} color={scene.paper} order={ON_TOP - 2} />
      {storey.rooms.map((room) => {
        const zone = zonesById.get(room.zoneId ?? "");
        return zone ? (
          <Fill
            key={room.id}
            polygon={room.polygon}
            color={zone.color}
            opacity={0.28}
            order={ON_TOP - 1}
          />
        ) : null;
      })}
      {drawing.poche.map((p, i) => (
        <Fill
          key={i}
          polygon={p.polygon}
          color={p.selected ? scene.select : scene.ink}
          order={ON_TOP}
        />
      ))}
      <Lines lines={drawing.windows} color={scene.select} width={1.2} />
      <Lines lines={drawing.doors} color={scene.ink} width={1.2} />
      <Lines lines={drawing.leaves} color={scene.ink} width={1.6} />
      <Lines lines={drawing.arcs} color={scene.muted} width={1} dashed />
      <Lines lines={drawing.selectedOpenings} color={scene.select} width={2.6} />
      <Lines lines={dims.flatMap((d) => [d.line, ...d.extensions])} color={scene.muted} width={1} />
      <Lines lines={dims.flatMap((d) => d.ticks)} color={scene.ink} width={1.6} />
      {drawing.overall.map((d, i) => (
        <Label
          key={`o${String(i)}`}
          at={d.label}
          along={d.line}
          text={formatMetres(d.length, language)}
          strong
        />
      ))}
      {drawing.chain
        .filter((d) => d.length >= metres(MIN_LABELLED_PX))
        .map((d, i) => (
          <Label
            key={`c${String(i)}`}
            at={d.label}
            along={d.line}
            text={formatMetres(d.length, language)}
          />
        ))}
      {drawing.interior.map((wall) => (
        <Label
          key={`i${String(wall.index)}`}
          at={{
            x: (wall.outerA.x + wall.innerB.x) / 2,
            y: (wall.outerA.y + wall.innerB.y) / 2,
          }}
          along={[wall.outerA, wall.outerB]}
          text={formatMetres(distance(wall.outerA, wall.outerB), language)}
        />
      ))}
    </group>
  );
}

/** A filled polygon, flat in plan: the sheet, a room's zone colour, or a wall piece. */
function Fill({
  polygon,
  color,
  order,
  opacity = 1,
}: {
  polygon: readonly Vec2[];
  color: string;
  order: number;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    // The shape is drawn in XY and laid flat by the rotation, which turns y into -z.
    const shape = new Shape(polygon.map((p) => new Vector2(p.x, -p.y)));
    return new ShapeGeometry(shape);
  }, [polygon]);
  useDisposableGeometry(geometry);
  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={noRaycast}
      renderOrder={order}
    >
      {/* Transparent even when opaque: that pass draws after the ground grid, so the grid
          never shows through the sheet. */}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Many separate segments as one screen-space line: one draw call per style. */
function Lines({
  lines,
  color,
  width,
  dashed = false,
}: {
  lines: PlanLine[];
  color: string;
  width: number;
  dashed?: boolean;
}) {
  if (lines.length === 0) return null;
  const points = lines.flatMap(([a, b]): [number, number, number][] => [
    [a.x, 0.01, a.y],
    [b.x, 0.01, b.y],
  ]);
  return (
    <Line
      points={points}
      segments
      color={color}
      lineWidth={width}
      dashed={dashed}
      dashSize={0.12}
      gapSize={0.08}
      // In the transparent pass with the fills, so their order decides and the lines stay on top.
      transparent
      depthTest={false}
      renderOrder={ON_TOP + 1}
      raycast={noRaycast}
    />
  );
}

/**
 * A dimension figure in the mono face on a white chip, as the 20° app writes values, turned
 * to run along its line and kept upright, as on a drawing.
 */
function Label({
  at,
  along,
  text,
  strong = false,
}: {
  at: Vec2;
  along: PlanLine;
  text: string;
  strong?: boolean;
}) {
  // In the plan camera screen x is plan x and screen down is plan +y, as CSS rotates.
  let angle = (Math.atan2(along[1].y - along[0].y, along[1].x - along[0].x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return (
    <Html
      position={[at.x, 0.02, at.y]}
      center
      zIndexRange={[5, 0]}
      style={{ pointerEvents: "none" }}
    >
      <span
        style={{ display: "inline-block", transform: `rotate(${angle.toFixed(1)}deg)` }}
        className={
          strong
            ? "rounded-soft border border-line bg-paper px-1.5 py-px font-num text-xs whitespace-nowrap text-ink shadow-soft select-none"
            : "rounded-soft bg-paper/90 px-1 font-num text-[11px] whitespace-nowrap text-muted select-none"
        }
      >
        {text}
      </span>
    </Html>
  );
}
