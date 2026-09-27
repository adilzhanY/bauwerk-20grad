import { type CompassDirection, angleDifference, expectedWallFacing } from "lod2-core/exif";
import type { WallPlane } from "lod2-core/wall";
import type { Translate } from "../../api/errors.ts";
import { COMPASS_WARN_DEG } from "./constants.ts";

/**
 * Compare where the camera pointed with where the wall faces. The camera looks at the
 * wall, so the wall should face roughly back at the camera.
 */
export function describeCompass(
  t: Translate,
  compass: CompassDirection | null,
  wallFacing: number | null,
): { text: string; warn: boolean } {
  if (!compass) return { text: t("photo.compass.none"), warn: false };
  const expected = Math.round(expectedWallFacing(compass.degrees));
  if (wallFacing === null) {
    return { text: t("photo.compass.suggests", { expected }), warn: false };
  }
  const off = angleDifference(expectedWallFacing(compass.degrees), wallFacing);
  if (off > COMPASS_WARN_DEG) {
    return {
      text: t("photo.compass.mismatch", { facing: Math.round(wallFacing), expected }),
      warn: true,
    };
  }
  return { text: t("photo.compass.match", { off: Math.round(off) }), warn: false };
}

/** One line for the toolbar: size above ground, and how much of the model wall is buried. */
export function describeWall(
  t: Translate,
  num: (value: number, digits: number) => string,
  plane: WallPlane | null,
  groundZ: number | null,
  buriedDepth: number,
): string {
  if (!plane) return t("photo.wall.notVertical");
  const size = t("photo.wall.size", { width: num(plane.width, 2), height: num(plane.height, 2) });
  if (groundZ === null) return t("photo.wall.groundUnknown", { size });
  if (buriedDepth < 0.05) return t("photo.wall.aboveGround", { size });
  return t("photo.wall.buried", { size, buried: num(buriedDepth, 2) });
}
