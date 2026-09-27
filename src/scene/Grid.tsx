import { Grid as DreiGrid } from "@react-three/drei";
import { GRID_SIZE } from "@/geometry/types";
import { useEditorStore } from "@/store/building";
import { useSceneColors } from "./useSceneColors";

export function Grid() {
  const show = useEditorStore((s) => s.showGrid);
  const scene = useSceneColors();
  if (!show) return null;
  return (
    <DreiGrid
      position={[0, 0.002, 0]}
      args={[300, 300]}
      cellSize={GRID_SIZE}
      cellThickness={0.7}
      cellColor={scene.grid}
      sectionSize={5}
      sectionThickness={1}
      sectionColor={scene.gridStrong}
      fadeDistance={170}
      fadeStrength={1.2}
      followCamera={false}
    />
  );
}
