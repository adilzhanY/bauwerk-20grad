import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { offsetPolygon } from "@/geometry/roof";
import { colors } from "@/lib/colors";
import { storeyElevation } from "@/store/selectors";
import { useEditorStore } from "@/store/building";
import { storeyDisplay } from "./display";
import { useSceneColors } from "./useSceneColors";

/** Just outside the facade, so the lines never flicker against the wall. */
const CLEARANCE = 0.015;

/**
 * The lines of the reference look (docs/design/editor-3d.png): a thin grey line around the
 * facade at every floor, and a blue line where the building meets the terrain.
 */
export function FacadeLines() {
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const scene = useSceneColors();
  const ring = useMemo(() => {
    const outer = offsetPolygon(building.footprint, CLEARANCE);
    const first = outer[0];
    return first && outer.length > 2 ? [...outer, first] : [];
  }, [building.footprint]);
  if (ring.length === 0) return null;

  const at = (y: number) => ring.map((p): [number, number, number] => [p.x, y, p.y]);
  // A floor line where a drawn storey starts, except at the terrain, which has its own line.
  const floors = building.storeys
    .filter((s) => storeyDisplay(building, s.id, activeStoreyId, otherStoreys) === "solid")
    .map((s) => storeyElevation(building, s.id))
    .filter((y) => Math.abs(y) > 1e-3);

  return (
    <group>
      {floors.map((y) => (
        <Line key={y} points={at(y)} color={colors.storeyLine} lineWidth={1} />
      ))}
      <Line points={at(0.02)} color={scene.select} lineWidth={1.6} />
    </group>
  );
}
