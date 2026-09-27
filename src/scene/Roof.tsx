import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from "three";
import { buildRoof } from "@/geometry/roof";
import type { RoofFace } from "@/geometry/roof";
import { colors } from "@/lib/colors";
import { Outline } from "./Outline";
import { sameSelection, useEditorStore } from "@/store/building";
import { selectTotalHeight } from "@/store/selectors";
import { useHover } from "./hover";
import { mergeAll, prismGeometry } from "./three";
import { useDisposableGeometry } from "./useDisposableGeometry";

const ROOF_COLOR = "#cd5454";
const ROOF_THICKNESS = 0.2;
const ROOF_SELECTION = { kind: "roof" } as const;

/** Roof faces triangulated over their plan projection, or a flat slab. Click selects the roof. */
export function Roof() {
  const building = useEditorStore((s) => s.building);
  const top = useEditorStore(selectTotalHeight);
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  const selected = useEditorStore((s) => sameSelection(s.selection, ROOF_SELECTION));
  const hovered = useEditorStore((s) => sameSelection(s.hovered, ROOF_SELECTION));
  const other = useEditorStore((s) => s.otherStoreys);
  // A selected roof is always drawn solid so pitch and overhang edits are visible.
  const display = selected ? "solid" : other.roof;
  const hover = useHover(ROOF_SELECTION, display !== "outline");

  const geometry = useMemo(() => {
    if (building.storeys.length === 0) return null;
    const roof = buildRoof(building, top);
    if (roof.builtKind === "flat")
      return prismGeometry(building.footprint, top, top + ROOF_THICKNESS);
    return mergeAll(roof.faces.map(faceGeometry));
  }, [building, top]);
  useDisposableGeometry(geometry);

  if (!geometry || display === "hidden") return null;
  if (display === "outline") return <Outline geometry={geometry} />;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || tool !== "select") return;
    e.stopPropagation();
    select(ROOF_SELECTION);
  };
  return (
    <mesh geometry={geometry} onClick={onClick} castShadow receiveShadow {...hover}>
      <meshStandardMaterial
        color={selected ? colors.accent : hovered ? "#a1857a" : ROOF_COLOR}
        emissive={selected ? colors.accent : "#000000"}
        emissiveIntensity={selected ? 0.3 : 0}
        roughness={0.85}
        transparent={display === "ghost"}
        opacity={display === "ghost" ? Math.min(1, other.ghostOpacity + 0.35) : 1}
        depthWrite={display !== "ghost"}
        side={2}
      />
    </mesh>
  );
}

/** Triangulates a planar face over its plan projection and lifts the vertices. */
function faceGeometry(face: RoofFace): BufferGeometry {
  const contour = face.points.map((p) => new Vector2(p.x, -p.y));
  const tris = ShapeUtils.triangulateShape(contour, []);
  const positions: number[] = [];
  for (const tri of tris) {
    const [a, b, c] = tri;
    for (const i of [a ?? 0, c ?? 0, b ?? 0]) {
      const p = face.points[i];
      if (p) positions.push(p.x, p.z, p.y);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  g.computeVertexNormals();
  return g;
}
