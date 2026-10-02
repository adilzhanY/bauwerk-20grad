import { toPlanImage } from "@/lod2/api/floorplan";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { useEditorStore } from "@/store/building";
import { DOOR_STAGGER_MS, WALL_STAGGER_MS } from "./previewTiming";

const xy = (p: [number, number]) => ({ x: p[0], y: p[1] });

/**
 * The drawing with the outline, walls and doors the service found, drawn over it. The walls
 * draw themselves in one after another and the doors pop in after them, so the result
 * arrives the way the AI found it. `fit` shows only the building and a margin round it: on an
 * architect's sheet the plan is a small part of the page.
 */
export function PlanPreview({
  reading,
  url,
  label,
  fit = false,
}: {
  reading: FloorPlanReading;
  url: string;
  label: string;
  fit?: boolean;
}) {
  const footprint = useEditorStore((s) => s.building.footprint);
  const [w, h] = reading.imageSize;
  const at = (p: { x: number; y: number }) => toPlanImage(reading, p);
  const line = (a: [number, number], b: [number, number]) => {
    const p = at(xy(a));
    const q = at(xy(b));
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
  };
  let view = [0, 0, w, h];
  if (fit && footprint.length > 0) {
    const pts = footprint.map(at);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const margin =
      0.12 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const x0 = Math.max(0, Math.min(...xs) - margin);
    const y0 = Math.max(0, Math.min(...ys) - margin);
    view = [
      x0,
      y0,
      Math.min(w, Math.max(...xs) + margin) - x0,
      Math.min(h, Math.max(...ys) + margin) - y0,
    ];
  }
  // Lines as thick on screen whether the whole drawing shows or only the building.
  const stroke = Math.max(view[2] ?? w, view[3] ?? h) / 150;
  return (
    <svg viewBox={view.map(String).join(" ")} role="img" aria-label={label} className="w-full">
      <image href={url} width={w} height={h} />
      <polygon
        points={footprint.map((p) => `${String(at(p).x)},${String(at(p).y)}`).join(" ")}
        fill="none"
        stroke="var(--color-select)"
        strokeWidth={stroke}
        opacity={0.6}
      />
      {reading.walls.map((wall, i) => (
        <line
          key={`w${String(i)}`}
          {...line(wall.a, wall.b)}
          pathLength={1}
          className="ai-draw"
          style={{ animationDelay: `${String(i * WALL_STAGGER_MS)}ms` }}
          stroke="var(--color-select)"
          // As thick as the service measured it, so the band lies on the drawn wall.
          strokeWidth={Math.max(stroke, (wall.thickness ?? 0) * reading.transform.scale)}
          strokeOpacity={wall.thickness ? 0.6 : 1}
          strokeLinecap="round"
        />
      ))}
      {reading.doors.map((door, i) => (
        <line
          key={`d${String(i)}`}
          {...line(door.a, door.b)}
          className="ai-pop"
          style={{
            animationDelay: `${String(reading.walls.length * WALL_STAGGER_MS + i * DOOR_STAGGER_MS)}ms`,
          }}
          stroke="var(--color-mark)"
          strokeWidth={stroke * 1.6}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
