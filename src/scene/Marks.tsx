import { Line } from "./Line";
import { noRaycast } from "./three";

/** Over the floor plan drawing, which lies on top of the storey. */
export const MARKS_ON_TOP = 30;

type At = [number, number, number];

/** A flat dot on the floor (or a ring), always drawn on top: where a wall end goes. */
export function Dot({
  at,
  radius,
  color,
  ring = false,
}: {
  at: At;
  radius: number;
  color: string;
  ring?: boolean;
}) {
  return (
    <mesh
      position={at}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={MARKS_ON_TOP + 1}
      raycast={noRaycast}
    >
      {ring ? (
        <ringGeometry args={[radius * 0.7, radius, 24]} />
      ) : (
        <circleGeometry args={[radius, 24]} />
      )}
      <meshBasicMaterial
        color={color}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** A cross on the floor: a wall end cannot go here (on a window or a door, or in the open). */
export function Cross({ at, size, color }: { at: At; size: number; color: string }) {
  const [x, y, z] = at;
  return (
    <Line
      points={[
        [x - size, y, z - size],
        [x + size, y, z + size],
        [x - size, y, z + size],
        [x + size, y, z - size],
      ]}
      segments
      color={color}
      lineWidth={2.5}
      depthTest={false}
      renderOrder={MARKS_ON_TOP + 2}
      raycast={noRaycast}
    />
  );
}
