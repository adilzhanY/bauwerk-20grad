import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Shape, ShapeGeometry, Vector2 } from "three";
import { normalize, sub } from "@/geometry/polygon";
import type { Vec2 } from "@/geometry/types";
import { MARKS_ON_TOP } from "./Marks";
import { useDisposableGeometry } from "./useDisposableGeometry";

/**
 * An invisible strip along a line that takes the pointer, `width` to each side: a thin
 * thing on the plan (a measurement, a 10 cm wall) made easy to click.
 */
export function HitStrip({
  a,
  b,
  y,
  width,
  onClick,
  hover,
  renderOrder = MARKS_ON_TOP,
  ...pointer
}: {
  a: Vec2;
  b: Vec2;
  y: number;
  width: number;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  hover: {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
    onPointerOut: () => void;
  };
  renderOrder?: number;
  /** For something that is dragged along the strip, such as a wall. */
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerCancel?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const d = normalize(sub(b, a));
    const n = { x: -d.y * width, y: d.x * width };
    const corners = [
      { x: a.x + n.x, y: a.y + n.y },
      { x: b.x + n.x, y: b.y + n.y },
      { x: b.x - n.x, y: b.y - n.y },
      { x: a.x - n.x, y: a.y - n.y },
    ];
    // Drawn in XY and laid flat by the rotation, which turns y into -z.
    return new ShapeGeometry(new Shape(corners.map((p) => new Vector2(p.x, -p.y))));
  }, [a, b, width]);
  useDisposableGeometry(geometry);
  return (
    <mesh
      geometry={geometry}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={renderOrder}
      onClick={onClick}
      {...hover}
      {...pointer}
    >
      <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  );
}
