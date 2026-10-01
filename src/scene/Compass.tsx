import { Html } from "@react-three/drei";
import { Line } from "./Line";
import { northInPlan } from "@/geometry/geo";
import { bounds } from "@/geometry/polygon";
import { useSceneColors } from "./useSceneColors";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";

/**
 * A north arrow on the ground next to the footprint, following the geo rotation. Where the
 * building lies (latitude, longitude, UTM, rotation) is in the building's Location section,
 * not drawn into the view, where it landed on top of the panels.
 */
export function Compass() {
  const t = useT();
  const footprint = useEditorStore((s) => s.building.footprint);
  const origin = useEditorStore((s) => s.building.origin);
  // The arrow and the chip would lie across the floor plan's dimensions; the minimap shows north.
  const planView = useEditorStore((s) => s.planView);
  const scene = useSceneColors();
  const { min, max } = bounds(footprint);
  const north = northInPlan(origin);
  const base: [number, number] = [max.x + 2, min.y - 1];
  const tip: [number, number] = [base[0] + north.x * 2, base[1] + north.y * 2];
  const color = origin ? scene.select : scene.muted;
  if (planView) return null;
  return (
    <group>
      <Line
        points={[
          [base[0], 0.03, base[1]],
          [tip[0], 0.03, tip[1]],
        ]}
        color={color}
        lineWidth={2}
      />
      <mesh position={[tip[0], 0.03, tip[1]]}>
        <sphereGeometry args={[0.12, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html
        position={[tip[0] + north.x * 0.6, 0.05, tip[1] + north.y * 0.6]}
        center
        style={{ pointerEvents: "none" }}
      >
        <span className="font-num text-sm font-semibold select-none" style={{ color }}>
          {t("location.north")}
        </span>
      </Html>
    </group>
  );
}
