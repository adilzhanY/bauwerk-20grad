import { Html } from "@react-three/drei";
import { Line } from "./Line";
import { northInPlan, planToLatLon, toUtm } from "@/geometry/geo";
import { formatNumber } from "@/lib/format";
import { bounds, centroid } from "@/geometry/polygon";
import { useSceneColors } from "./useSceneColors";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";

/** A north arrow on the ground next to the footprint, following the geo rotation. */
export function Compass() {
  const t = useT();
  const footprint = useEditorStore((s) => s.building.footprint);
  const origin = useEditorStore((s) => s.building.origin);
  const language = useEditorStore((s) => s.language);
  // The arrow and the chip would lie across the floor plan's dimensions; the minimap shows north.
  const planView = useEditorStore((s) => s.planView);
  const scene = useSceneColors();
  // The chip reads the building centre, so it follows the building when it is moved.
  const centre = origin ? planToLatLon(centroid(footprint), origin) : { lat: 0, lon: 0 };
  const utm = toUtm(centre);
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
      {origin && (
        <Html position={[base[0], 0.05, base[1] + 1.2]} center style={{ pointerEvents: "none" }}>
          <span
            className="rounded-soft border border-line bg-paper/90 px-2 py-0.5 font-num text-xs whitespace-nowrap select-none"
            style={{ color }}
          >
            {formatNumber(centre.lat, language, 5)}° N · {formatNumber(centre.lon, language, 5)}° E
            · UTM {utm.zone}
            {utm.north ? "N" : "S"} · {formatNumber(origin.rotation, language, 0)}°
          </span>
        </Html>
      )}
    </group>
  );
}
