import { Html } from "@react-three/drei";
import { distance, edges } from "@/geometry/polygon";
import { formatMetres } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { selectActiveStorey, storeyElevation } from "@/store/selectors";

/**
 * Length labels on exterior and interior walls in the 3D view, shown while the footprint or
 * wall tool is active. The floor plan view draws full dimension lines instead (PlanDrawing).
 */
export function Dimensions() {
  const tool = useEditorStore((s) => s.tool);
  const planView = useEditorStore((s) => s.planView);
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const storey = useEditorStore(selectActiveStorey);
  if (planView || (tool !== "footprint" && tool !== "interiorWall")) return null;
  const elevation = storey ? storeyElevation(building, storey.id) : 0;
  const y = elevation + 0.1;
  const label = (key: string, x: number, z: number, text: string) => (
    <Html
      key={key}
      position={[x, y, z]}
      center
      zIndexRange={[5, 0]}
      style={{ pointerEvents: "none" }}
    >
      <span className="rounded-soft bg-paper/90 px-1.5 font-num text-xs text-ink select-none whitespace-nowrap">
        {text}
      </span>
    </Html>
  );
  return (
    <group>
      {edges(building.footprint).map((e) =>
        label(
          `ext-${e.index}`,
          (e.a.x + e.b.x) / 2 + e.normal.x * 0.8,
          (e.a.y + e.b.y) / 2 + e.normal.y * 0.8,
          formatMetres(e.length, language),
        ),
      )}
      {storey?.interiorWalls.map((w, i) =>
        label(
          `int-${i}`,
          (w.a.x + w.b.x) / 2,
          (w.a.y + w.b.y) / 2,
          formatMetres(distance(w.a, w.b), language),
        ),
      )}
    </group>
  );
}
