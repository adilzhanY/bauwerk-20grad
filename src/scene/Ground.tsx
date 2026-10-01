import type { ThreeEvent } from "@react-three/fiber";
import { useEditorStore } from "@/store/building";

/** Large plane at y = 0. Clicking it clears the selection. Tools hook in later. */
export function Ground() {
  const clearSelection = useEditorStore((s) => s.clearSelection);
  // The ground is the page's blue-grey gradient behind a transparent canvas, or the map tiles:
  // this plane only takes clicks.
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // a drag, not a click
    clearSelection();
  };
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} onClick={onClick}>
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
