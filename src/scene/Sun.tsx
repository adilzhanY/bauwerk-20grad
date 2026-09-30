import { useMemo } from "react";
import { Line } from "./Line";
import { Object3D } from "three";
import { bounds } from "@/geometry/polygon";
import { sunPath } from "@/geometry/sun";
import { BERLIN_FALLBACK, instantFor, sunAt } from "@/lib/sunTime";
import { sunWorldPosition } from "./sunWorld";
import { useEditorStore } from "@/store/building";
import { selectTotalHeight } from "@/store/selectors";

const RADIUS_FACTOR = 2.2;

/** A directional light that follows the real sun, with its path for the chosen day. */
export function Sun() {
  const sun = useEditorStore((s) => s.sun);
  const building = useEditorStore((s) => s.building);
  const height = useEditorStore(selectTotalHeight);
  const origin = building.origin ?? { ...BERLIN_FALLBACK, rotation: 0 };
  const { min, max } = bounds(building.footprint);
  const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  const radius = Math.max(max.x - min.x, max.y - min.y, 6) * RADIUS_FACTOR + height;
  const position = useMemo(
    () => sunAt(sun.dayOfYear, sun.minutes, origin.lat, origin.lon),
    [sun.dayOfYear, sun.minutes, origin.lat, origin.lon],
  );
  const path = useMemo(
    () =>
      sunPath(instantFor(sun.dayOfYear, 720), origin.lat, origin.lon, 20).map((p) =>
        sunWorldPosition(p.azimuth, p.elevation, centre, radius, origin.rotation),
      ),
    [sun.dayOfYear, origin.lat, origin.lon, origin.rotation, centre.x, centre.y, radius], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const target = useMemo(() => new Object3D(), []);
  if (!sun.enabled) return null;
  const up = position.elevation > 0;
  const pos = sunWorldPosition(
    position.azimuth,
    Math.max(position.elevation, 0.5),
    centre,
    radius,
    origin.rotation,
  );
  return (
    <group>
      {up && (
        <>
          <primitive object={target} position={[centre.x, 0, centre.y]} />
          <directionalLight
            position={pos}
            target={target}
            intensity={1.4 + Math.sin((position.elevation * Math.PI) / 180) * 0.8}
            color={position.elevation < 10 ? "#ffd2a1" : "#fff6e6"}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-radius}
            shadow-camera-right={radius}
            shadow-camera-top={radius}
            shadow-camera-bottom={-radius}
            shadow-camera-far={radius * 3}
          />
        </>
      )}
      {path.length >= 2 && (
        <Line
          points={path}
          color="#e8a838"
          lineWidth={1.5}
          dashed
          dashSize={0.6}
          gapSize={0.4}
          transparent
          opacity={0.8}
        />
      )}
      {up && (
        <mesh position={pos}>
          <sphereGeometry args={[0.35, 16, 16]} />
          <meshBasicMaterial color="#ffb347" />
        </mesh>
      )}
    </group>
  );
}
