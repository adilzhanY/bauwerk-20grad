import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Line } from "./Line";
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Shape,
  ShapeGeometry,
  Vector2,
} from "three";
import type { Mesh, MeshBasicMaterial } from "three";
import { effectiveWallThickness } from "@/geometry/layers";
import { openingsOn } from "@/geometry/openings";
import {
  clearRoomPolygon,
  dimension,
  openingChain,
  openingSymbol,
  roomMeasures,
  span,
  spanThrough,
  wallJunctions,
  wallPoche,
} from "@/geometry/plan";
import type { Arrowhead, Dimension, PlanLine } from "@/geometry/plan";
import { add, bounds, centroid, pointInPolygon, scale } from "@/geometry/polygon";
import type { Vec2 } from "@/geometry/types";
import { buildWalls, interiorWallAsWall } from "@/geometry/walls";
import { interiorWallThickness } from "@/geometry/constructions";
import { pieceRange } from "@/geometry/wallGraph";
import { useT } from "@/i18n/useT";
import { formatArea, formatBaumass } from "@/lib/format";
import { sameSelection, useEditorStore } from "@/store/building";
import { selectActiveStorey, storeyElevation } from "@/store/selectors";
import { PlanHandles } from "./PlanHandles";
import { WallPicks } from "./WallPicks";
import type { PlanHandle } from "./PlanHandles";
import { noRaycast } from "./three";
import { useDisposableGeometry } from "./useDisposableGeometry";
import { useSceneColors } from "./useSceneColors";

/**
 * Screen sizes of the dimensioning, px: the chain of openings close to the wall, the overall
 * length further out, and the gaps and ticks. Converted to metres with the plan zoom, so the
 * drawing reads the same for a garden shed and an office block.
 */
const CHAIN_OFFSET_PX = 30;
const OVERALL_OFFSET_PX = 76;
/** How far inside the wall a window's sill height is written. */
const SILL_INSET_PX = 16;
const STYLE_PX = { gap: 6, overrun: 8, arrow: 9 };
/** Interior walls: the chain of doors, or the length of a wall without doors. */
const INTERIOR_CHAIN_PX = 18;
/** Room spans run clear of the stamp: the width below it, the depth beside it. */
const ROOM_WIDTH_BELOW_PX = 36;
const ROOM_DEPTH_BESIDE_PX = 74;
/**
 * A span needs room on screen: its own length, and space across it for the stamp and the
 * wall dimensions on both sides. A smaller room keeps its stamp, which has both sizes.
 */
const MIN_ROOM_SPAN_PX = 120;
const MIN_ROOM_CLEAR_PX = { width: 150, depth: 200 };
/** Chain pieces shorter than this on screen get no label, so the numbers never overlap. */
const MIN_LABELLED_PX = 34;
/**
 * The reveal after a floor plan read by the AI is applied: a scan band crosses the building
 * left to right, and each wall, door and room it passes glows in the AI colours and settles
 * into ink.
 */
const REVEAL_SWEEP_MS = 1500;
const REVEAL_GLOW_MS = 1100;
const REVEAL_BAND_PX = 110;
/**
 * The selected room is tinted in the selection colour, clearly but without hiding the
 * drawing; the room under the pointer gets a fainter tint, so a click's target shows.
 */
const ROOM_SELECTED_OPACITY = 0.16;
const ROOM_HOVER_OPACITY = 0.07;
/** Drawn after everything else and through it: the plan is the top layer of the view. */
const ON_TOP = 10;

/**
 * The floor plan view drawn the way German plans are (DIN 1356): every wall of the active
 * storey cut and filled in ink, windows as breaks with sills and a double frame line, doors
 * with their leaf and swing, dimension chains outside with the openings as width over
 * height, the sill height (BRH) inside each window, the interior walls with their doors, and
 * in each room its clear width and depth wall to wall and a stamp with name, area and size.
 * Dimensions end in arrows. Figures stay horizontal so they read without turning the head.
 * The drawing itself takes no clicks; PlanHandles lays grips over the openings, so an
 * opening can be moved or, by its arrows, resized, and every figure follows live.
 */
export function PlanDrawing() {
  const building = useEditorStore((s) => s.building);
  const storey = useEditorStore(selectActiveStorey);
  const selection = useEditorStore((s) => s.selection);
  const selectedRoomId = selection?.kind === "room" ? selection.id : null;
  const hoveredRoomId = useEditorStore((s) => (s.hovered?.kind === "room" ? s.hovered.id : null));
  const language = useEditorStore((s) => s.language);
  const t = useT();
  const scene = useSceneColors();
  // Pixels per metre of the orthographic plan camera; 1 outside it.
  const zoom = useLiveZoom();
  const metres = (px: number) => px / Math.max(zoom, 1e-6);
  const reveal = usePlanReveal(storey?.id ?? null, building.footprint, metres(REVEAL_BAND_PX));
  const zonesById = useMemo(() => new Map(building.zones.map((z) => [z.id, z])), [building.zones]);

  const drawing = useMemo(() => {
    if (!storey) return null;
    const thickness = effectiveWallThickness(building);
    const exterior = buildWalls(building.footprint, thickness, storey.height);
    const thicknessOf = interiorWallThickness(building.constructions);
    const interior = storey.interiorWalls.map((segment, index) =>
      interiorWallAsWall(segment, index, storey.height, thicknessOf(segment)),
    );
    const poche: { polygon: Vec2[]; selected: boolean; interior: boolean }[] = [];
    const windows: PlanLine[] = [];
    const doors: PlanLine[] = [];
    const leaves: PlanLine[] = [];
    const arcs: PlanLine[] = [];
    // Door symbols in interior walls, kept apart so the AI reveal can bring them in.
    const inner = { doors: [] as PlanLine[], leaves: [] as PlanLine[], arcs: [] as PlanLine[] };
    const selectedOpenings: PlanLine[] = [];
    const overall: Dimension[] = [];
    const chain: PlanDimension[] = [];
    const walls: Dimension[] = [];
    const sills: { at: Vec2; sill: number }[] = [];
    const handles: PlanHandle[] = [];
    const style = {
      gap: metres(STYLE_PX.gap),
      overrun: metres(STYLE_PX.overrun),
      arrow: metres(STYLE_PX.arrow),
    };

    const drawWall = (wall: (typeof exterior)[number], isInterior: boolean) => {
      const openings = openingsOn(storey.openings, wall.index, isInterior);
      const wallSelected = isInterior
        ? sameSelection(selection, { kind: "interiorWall", storeyId: storey.id, index: wall.index })
        : sameSelection(selection, { kind: "wall", storeyId: storey.id, wallIndex: wall.index });
      // An interior wall is drawn where it is seen (pieceRange): between the faces of the walls
      // it meets, straight through where it goes on, and round a corner.
      const wallCtx = {
        footprint: building.footprint,
        exteriorThickness: thickness,
        thicknessOf,
      };
      const range: [number, number] = isInterior
        ? pieceRange(wall.index, storey.interiorWalls, wallCtx)
        : [0, wall.length];
      for (const polygon of wallPoche(wall, openings, range))
        poche.push({ polygon, selected: wallSelected, interior: isInterior });
      for (const opening of openings) {
        const symbol = openingSymbol(wall, opening);
        const all = [...symbol.jambs, ...symbol.lines];
        if (sameSelection(selection, { kind: "opening", storeyId: storey.id, id: opening.id })) {
          selectedOpenings.push(...all, ...(symbol.leaf ? [symbol.leaf] : []));
        }
        if (opening.kind === "window") windows.push(...all);
        else (isInterior ? inner.doors : doors).push(...all);
        if (symbol.leaf) (isInterior ? inner.leaves : leaves).push(symbol.leaf);
        const innerLine = symbol.lines[symbol.lines.length - 1];
        if (!isInterior && opening.kind === "window" && innerLine) {
          const middle = scale(add(innerLine[0], innerLine[1]), 0.5);
          sills.push({
            at: add(middle, scale(wall.normal, -metres(SILL_INSET_PX))),
            sill: opening.sill,
          });
        }
        for (let i = 0; i + 1 < symbol.arc.length; i++) {
          const a = symbol.arc[i];
          const b = symbol.arc[i + 1];
          if (a && b) (isInterior ? inner.arcs : arcs).push([a, b]);
        }
      }
      const chainOffset = metres(isInterior ? INTERIOR_CHAIN_PX : CHAIN_OFFSET_PX);
      // And, as German inner chains do, it breaks at every wall meeting it on the chain's
      // side: clear width, that wall's thickness, clear width.
      const segment = isInterior ? storey.interiorWalls[wall.index] : undefined;
      const breaks = segment
        ? wallJunctions(
            segment,
            wall.normal,
            storey.interiorWalls.filter((_, j) => j !== wall.index),
            thicknessOf,
          )
        : [];
      // Measured as German inner chains are: to the face of a wall meeting it on the chain's side.
      const measured: [number, number] = isInterior
        ? pieceRange(wall.index, storey.interiorWalls, wallCtx, wall.normal)
        : range;
      const chainPieces = openingChain(wall, openings, chainOffset, style, measured, breaks);
      chain.push(...chainPieces.map((piece) => ({ ...piece, interior: isInterior })));
      if (isInterior) {
        const along = (start: Vec2, u: number) => add(start, scale(wall.direction, u));
        // A wall with doors reads its length from the chain; the overall line on the other
        // side is drawn only while the wall is selected, so it does not cross every room.
        if (chainPieces.length === 0) {
          walls.push(
            dimension(
              along(wall.outerA, measured[0]),
              along(wall.outerA, measured[1]),
              wall.normal,
              chainOffset,
              style,
            ),
          );
        } else if (wallSelected) {
          const otherSide = pieceRange(
            wall.index,
            storey.interiorWalls,
            wallCtx,
            scale(wall.normal, -1),
          );
          walls.push(
            dimension(
              along(wall.innerA, otherSide[0]),
              along(wall.innerA, otherSide[1]),
              scale(wall.normal, -1),
              chainOffset,
              style,
            ),
          );
        }
      } else {
        overall.push(
          dimension(wall.outerA, wall.outerB, wall.normal, metres(OVERALL_OFFSET_PX), style),
        );
      }
      for (const opening of openings) {
        handles.push({ wall, interior: isInterior, opening, chainOffset });
      }
    };
    for (const wall of exterior) drawWall(wall, false);
    for (const wall of interior) drawWall(wall, true);

    const rooms = storey.rooms
      .filter((room) => room.polygon.length >= 3)
      .map((room) => {
        // Measured on the clear floor, between the inner faces of the walls, as a plan
        // writes a room's size; the stored outline runs along the walls' outer faces and
        // centre lines, so arrows on it ended inside the walls.
        const floor = clearRoomPolygon(
          room.polygon,
          building.footprint,
          thickness,
          storey.interiorWalls,
          thicknessOf,
        );
        const m = roomMeasures(floor);
        const spans: Dimension[] = [];
        const across = (offset: Vec2, direction: Vec2, clear: number) => {
          if (
            clear * zoom <
            (direction === m.u ? MIN_ROOM_CLEAR_PX.width : MIN_ROOM_CLEAR_PX.depth)
          )
            return;
          const through = add(m.stamp, offset);
          const ends = spanThrough(
            floor,
            pointInPolygon(through, floor) ? through : m.stamp,
            direction,
          );
          if (!ends) return;
          const piece = span(ends[0], ends[1], style);
          if (piece.length * zoom >= MIN_ROOM_SPAN_PX) spans.push(piece);
        };
        // The width needs the room's depth to sit below the stamp, and the other way round.
        across(scale(m.v, -metres(ROOM_WIDTH_BELOW_PX)), m.u, m.depth);
        across(scale(m.u, metres(ROOM_DEPTH_BESIDE_PX)), m.v, m.width);
        return { room, measures: m, spans };
      });

    return {
      poche,
      windows,
      doors,
      leaves,
      arcs,
      inner,
      selectedOpenings,
      overall,
      chain,
      walls,
      sills,
      handles,
      rooms,
    };
    // `metres` only reads the zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, storey, selection, zoom]);

  if (!storey || !drawing) return null;
  const y = storeyElevation(building, storey.id) + storey.height + 0.05;
  const selectedId = selection?.kind === "opening" ? selection.id : null;
  // During the AI reveal, what the floor plan brought (interior walls, their doors and
  // dimensions, the rooms) appears only where the scan has passed.
  const shown = (p: Vec2) => !reveal || p.x <= reveal.sweepX;
  const middle = (line: PlanLine) => scale(add(line[0], line[1]), 0.5);
  const shownLines = (lines: PlanLine[]) => lines.filter((l) => shown(middle(l)));
  const chain = drawing.chain.filter((d) => !d.interior || shown(d.label));
  const wallDims = drawing.walls.filter((d) => shown(d.label));
  const rooms = drawing.rooms.filter((r) => shown(r.measures.stamp));
  const dims = [
    ...drawing.overall,
    ...wallDims,
    ...chain.filter((d) => d.opening?.id !== selectedId),
  ];
  const selectedDims = chain.filter((d) => d.opening?.id === selectedId);
  const roomSpans = rooms.flatMap((r) => r.spans);
  const pop = reveal !== null;

  return (
    <group position={[0, y, 0]}>
      {/* A white sheet under the drawing, so the 3D storey below does not show through; rooms
          keep their zone colour on it, lightly. */}
      <Fill polygon={building.footprint} color={scene.paper} order={ON_TOP - 2} />
      {rooms.map(({ room, measures }) => {
        const zone = zonesById.get(room.zoneId ?? "");
        const glow = reveal ? reveal.flash(measures.stamp.x) : 0;
        return (
          <group key={room.id}>
            {zone && (
              <Fill polygon={room.polygon} color={zone.color} opacity={0.28} order={ON_TOP - 1} />
            )}
            {glow > 0 && (
              <Fill
                polygon={room.polygon}
                color={scene.ai2}
                opacity={0.3 * glow}
                order={ON_TOP - 1}
              />
            )}
            {(room.id === selectedRoomId || room.id === hoveredRoomId) && (
              <Fill
                polygon={room.polygon}
                color={scene.select}
                opacity={room.id === selectedRoomId ? ROOM_SELECTED_OPACITY : ROOM_HOVER_OPACITY}
                order={ON_TOP - 1}
              />
            )}
          </group>
        );
      })}
      {drawing.poche.map((p, i) => {
        if (!p.interior || !reveal) {
          return (
            <Fill
              key={i}
              polygon={p.polygon}
              color={p.selected ? scene.accent : scene.ink}
              order={ON_TOP}
            />
          );
        }
        const at = centroid(p.polygon);
        return shown(at) ? (
          <Fill
            key={i}
            polygon={p.polygon}
            color={reveal.tint(scene.ink, scene.aiInk, at.x)}
            order={ON_TOP}
          />
        ) : null;
      })}
      <Lines lines={drawing.windows} color={scene.ink} width={1} />
      <Lines
        lines={[...drawing.doors, ...shownLines(drawing.inner.doors)]}
        color={scene.ink}
        width={1.2}
      />
      <Lines
        lines={[...drawing.leaves, ...shownLines(drawing.inner.leaves)]}
        color={scene.ink}
        width={1.6}
      />
      <Lines
        lines={[...drawing.arcs, ...shownLines(drawing.inner.arcs)]}
        color={scene.ink}
        width={0.8}
      />
      <Lines lines={drawing.selectedOpenings} color={scene.select} width={2.6} />
      <Lines lines={dims.flatMap((d) => [d.line, ...d.extensions])} color={scene.muted} width={1} />
      <Lines lines={roomSpans.map((d) => d.line)} color={scene.muted} width={0.8} />
      <Arrows arrows={[...dims, ...roomSpans].flatMap((d) => d.arrows)} color={scene.ink} />
      <Lines
        lines={selectedDims.flatMap((d) => [d.line, ...d.extensions])}
        color={scene.select}
        width={1.6}
      />
      <Arrows arrows={selectedDims.flatMap((d) => d.arrows)} color={scene.select} />
      {rooms.map(({ room, measures }) => (
        <Label
          key={room.id}
          pop={pop}
          at={measures.stamp}
          text={room.name || formatArea(room.area, language)}
          below={room.name ? formatArea(room.area, language) : undefined}
          extra={t("plan.roomSize", {
            width: formatBaumass(measures.width, language),
            depth: formatBaumass(measures.depth, language),
          })}
          stamp
        />
      ))}
      {rooms.flatMap(({ room, spans }) =>
        spans.map((d, i) => (
          <Label
            key={`r${room.id}-${String(i)}`}
            pop={pop}
            at={d.label}
            text={formatBaumass(d.length, language)}
            bare
          />
        )),
      )}
      {drawing.overall.map((d, i) => (
        <Label key={`o${String(i)}`} at={d.label} text={formatBaumass(d.length, language)} strong />
      ))}
      {wallDims.map((d, i) => (
        <Label
          key={`w${String(i)}`}
          at={d.label}
          text={formatBaumass(d.length, language)}
          pop={pop}
        />
      ))}
      {chain
        .filter((d) => d.length >= metres(MIN_LABELLED_PX) || d.opening?.id === selectedId)
        .map((d, i) => (
          <Label
            key={`c${String(i)}`}
            at={d.label}
            text={formatBaumass(d.length, language)}
            // An opening reads width over height, as on a German plan.
            below={d.opening ? formatBaumass(d.opening.height, language) : undefined}
            active={d.opening?.id === selectedId}
            pop={pop && d.interior}
          />
        ))}
      {drawing.sills.map((s, i) => (
        <Label
          key={`s${String(i)}`}
          at={s.at}
          text={t("plan.sill", { value: formatBaumass(s.sill, language) })}
          bare
        />
      ))}
      {reveal ? (
        <ScanBand
          startedAt={reveal.startedAt}
          footprint={building.footprint}
          width={metres(REVEAL_BAND_PX)}
          colors={scene}
        />
      ) : (
        <>
          <PlanHandles storeyId={storey.id} handles={drawing.handles} y={y} zoom={zoom} />
          <WallPicks storeyId={storey.id} y={y} zoom={zoom} />
        </>
      )}
    </group>
  );
}

/** A dimension that knows whether it measures an interior wall, which the reveal brings in. */
type PlanDimension = Dimension & { interior?: boolean };

interface Reveal {
  /** When the reveal began, performance.now(). */
  startedAt: number;
  /** Plan x the scan has reached. */
  sweepX: number;
  /** How much glow is left where the scan passed `x`: 1 just passed, 0 settled. */
  flash: (x: number) => number;
  /** `base` mixed toward `glow` by the glow left at `x`, as a CSS colour. */
  tint: (base: string, glow: string, x: number) => string;
}

/** How often the reveal redraws the plan (the walls' glow); the band itself moves every frame. */
const REVEAL_REDRAW_MS = 33;
/** The band fades in at the start and out as it leaves the building. */
const BAND_FADE_IN_MS = 180;
const BAND_FADE_OUT_MS = 320;

/** The sweep's progress, 0 to 1, `t` ms after the start: eased in and out, so it glides. */
function sweepProgress(t: number): number {
  const p = Math.min(Math.max(t / REVEAL_SWEEP_MS, 0), 1);
  return (1 - Math.cos(Math.PI * p)) / 2;
}

/** When the sweep reaches `progress`: the inverse of sweepProgress. */
function sweepTime(progress: number): number {
  const q = Math.min(Math.max(progress, 0), 1);
  return (REVEAL_SWEEP_MS * Math.acos(1 - 2 * q)) / Math.PI;
}

/** Where the band starts and ends, plan x: from before the building to fully past it. */
function sweepSpan(footprint: readonly Vec2[], band: number): [number, number] {
  const box = bounds(footprint);
  return [box.min.x - 1, box.max.x + 1 + band];
}

/**
 * The reveal clock for `storeyId`. Null when there is nothing to reveal. It redraws the plan
 * a few dozen times a second, which is enough for the glow of the walls; the band moves on
 * its own every frame (ScanBand), since redrawing the whole plan every frame made it stutter.
 * Ends itself, and is skipped for people who ask for reduced motion.
 */
function usePlanReveal(
  storeyId: string | null,
  footprint: readonly Vec2[],
  band: number,
): Reveal | null {
  const planReveal = useEditorStore((s) => s.planReveal);
  const endPlanReveal = useEditorStore((s) => s.endPlanReveal);
  const [now, setNow] = useState(() => performance.now());
  const active = planReveal !== null && planReveal.storeyId === storeyId;

  useEffect(() => {
    if (active && window.matchMedia("(prefers-reduced-motion: reduce)").matches) endPlanReveal();
  }, [active, endPlanReveal]);
  useFrame(() => {
    if (!active) return;
    const t = performance.now();
    if (t - planReveal.startedAt > REVEAL_SWEEP_MS + REVEAL_GLOW_MS) endPlanReveal();
    else if (t - now >= REVEAL_REDRAW_MS) setNow(t);
  });

  if (!active) return null;
  const [x0, x1] = sweepSpan(footprint, band);
  const t = now - planReveal.startedAt;
  const sweepX = x0 + sweepProgress(t) * (x1 - x0);
  const flash = (x: number) => {
    const age = t - sweepTime((x - x0) / (x1 - x0));
    return Math.min(Math.max(1 - age / REVEAL_GLOW_MS, 0), 1);
  };
  const tint = (base: string, glow: string, x: number) =>
    `#${new Color(base).lerp(new Color(glow), flash(x)).getHexString()}`;
  return { startedAt: planReveal.startedAt, sweepX, flash, tint };
}

/**
 * The scan band of the reveal: a soft blue to violet glow trailing a bright leading edge,
 * across the whole building, in the same colours as the AI scan over a picture. It places
 * itself every frame from the clock, without React, fades in at the start, and fades out as
 * it leaves the building.
 */
function ScanBand({
  startedAt,
  footprint,
  width,
  colors,
}: {
  startedAt: number;
  footprint: readonly Vec2[];
  width: number;
  colors: { ai1: string; ai2: string };
}) {
  const { ai1, ai2 } = colors;
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const texture = useMemo(() => {
    const rgba = (hex: string, a: number) => {
      const c = new Color(hex);
      return `rgba(${String(Math.round(c.r * 255))}, ${String(Math.round(c.g * 255))}, ${String(Math.round(c.b * 255))}, ${String(a)})`;
    };
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createLinearGradient(0, 0, 256, 0);
      g.addColorStop(0, rgba(ai1, 0));
      g.addColorStop(0.6, rgba(ai1, 0.28));
      g.addColorStop(0.9, rgba(ai2, 0.55));
      g.addColorStop(0.97, rgba(ai2, 0.95));
      g.addColorStop(1, rgba(ai2, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 1);
    }
    return new CanvasTexture(canvas);
  }, [ai1, ai2]);
  useEffect(
    () => () => {
      texture.dispose();
    },
    [texture],
  );
  const [x0, x1] = sweepSpan(footprint, width);
  const box = bounds(footprint);
  const height = box.max.y - box.min.y + 2;
  const cy = (box.min.y + box.max.y) / 2;
  const place = (t: number) => {
    const m = mesh.current;
    const mat = material.current;
    if (!m || !mat) return;
    m.position.x = x0 + sweepProgress(t) * (x1 - x0) - width / 2;
    mat.opacity = Math.min(
      1,
      Math.max(0, t / BAND_FADE_IN_MS),
      Math.max(0, (REVEAL_SWEEP_MS - t) / BAND_FADE_OUT_MS),
    );
  };
  useFrame(() => {
    place(performance.now() - startedAt);
  });
  return (
    <mesh
      ref={mesh}
      position={[x0 - width / 2, 0.03, cy]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={noRaycast}
      renderOrder={ON_TOP + 3}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        ref={material}
        map={texture}
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * The camera's zoom, followed every frame. The controls change the zoom on the camera
 * object without telling React, so reading it once per render left the arrows and gaps at
 * the old size until something else redrew the plan.
 */
function useLiveZoom(): number {
  const camera = useThree((s) => s.camera);
  const [zoom, setZoom] = useState(camera.zoom);
  useFrame(() => {
    if (camera.zoom !== zoom) setZoom(camera.zoom);
  });
  return zoom;
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
function Lines({ lines, color, width }: { lines: PlanLine[]; color: string; width: number }) {
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
      // In the transparent pass with the fills, so their order decides and the lines stay on top.
      transparent
      depthTest={false}
      renderOrder={ON_TOP + 1}
      raycast={noRaycast}
    />
  );
}

/** Filled arrowheads, all in one mesh. */
function Arrows({ arrows, color }: { arrows: Arrowhead[]; color: string }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(
        arrows.flatMap((tri) => tri.flatMap((p) => [p.x, 0.012, p.y])),
        3,
      ),
    );
    return g;
  }, [arrows]);
  useDisposableGeometry(geometry);
  if (arrows.length === 0) return null;
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={ON_TOP + 2}>
      <meshBasicMaterial
        color={color}
        side={DoubleSide}
        transparent
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * A figure on the plan in the mono face on a paper chip, as the 20° app writes values. Always
 * horizontal, whatever the wall's direction, so it reads without turning the head. With
 * `below` it is a fraction: an opening's width over its height, or a room's name over its area.
 */
function Label({
  at,
  text,
  below,
  strong = false,
  stamp = false,
  bare = false,
  active = false,
  pop = false,
  extra,
}: {
  /** Arrives with a short pop, for what the AI reveal brings in. */
  pop?: boolean;
  at: Vec2;
  text: string;
  below?: string;
  /** A third line, for a room stamp's width by depth. */
  extra?: string;
  /** The dimension of the opening being edited, in the selection colour. */
  active?: boolean;
  strong?: boolean;
  /** A room stamp: name and area in the room, without a chip. */
  stamp?: boolean;
  /** Just the text, for the sill height inside a window. */
  bare?: boolean;
}) {
  const chip = active
    ? "rounded-soft border border-select bg-paper px-1 text-select shadow-soft"
    : stamp
      ? "text-ink"
      : bare
        ? "text-muted"
        : strong
          ? "rounded-soft border border-line bg-paper px-1.5 py-px text-ink shadow-soft"
          : "rounded-soft bg-paper/90 px-1 text-muted";
  const size = strong || stamp ? "text-xs" : "text-[11px]";
  return (
    <Html
      position={[at.x, 0.02, at.y]}
      center
      zIndexRange={[5, 0]}
      style={{ pointerEvents: "none" }}
    >
      <span
        className={`inline-flex flex-col items-center leading-tight whitespace-nowrap select-none ${size} ${chip} ${pop ? "ai-pop" : ""}`}
      >
        <span className={stamp ? "font-medium" : "font-num"}>{text}</span>
        {below !== undefined && (
          <span className={`font-num ${stamp ? "text-muted" : "border-t border-current"}`}>
            {below}
          </span>
        )}
        {extra !== undefined && <span className="font-num text-muted">{extra}</span>}
      </span>
    </Html>
  );
}
