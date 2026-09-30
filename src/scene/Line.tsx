import type { ComponentProps } from "react";
import { Line as DreiLine } from "@react-three/drei";
import { DoubleSide } from "three";

/**
 * drei's Line, visible inside the mirrored plan group. The group's negative scale
 * (PLAN_MIRROR) makes three.js flip which side of a mesh faces front, and a fat line is a
 * mesh whose quads are built in screen space, so with the default front side every line
 * was culled. Drawing both sides keeps them. Use this, never drei's Line, under the group.
 */
export function Line(props: ComponentProps<typeof DreiLine>) {
  return <DreiLine side={DoubleSide} {...props} />;
}
