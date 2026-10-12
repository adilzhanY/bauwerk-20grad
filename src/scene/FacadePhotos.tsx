import { useEffect, useMemo, useState } from "react";
import { Line } from "./Line";
import { DoubleSide, SRGBColorSpace, TextureLoader } from "three";
import type { Texture } from "three";
import { buildWalls } from "@/geometry/walls";
import type { Wall } from "@/geometry/walls";
import type { Building } from "@/geometry/types";
import { colors } from "@/lib/colors";
import { useEditorStore, wallPhotoSlots } from "@/store/building";
import type { FacadePhoto as Photo } from "@/store/building";
import { yawFor } from "./three";
import { WALL_PX_PER_METRE } from "@/components/photo-editor/constants";

/** Just outside the wall's outer face, so the photo never fights the wall surface. */
const OUT = 0.02;

/**
 * The straightened facade photos on their walls, from the ground to the eaves, with every
 * opening of that wall outlined on top: a window that is off shows at once, in 3D and in the
 * elevation views.
 */
export function FacadePhotos() {
  const photos = useEditorStore((s) => s.facadePhotos);
  const show = useEditorStore((s) => s.showFacadePhotos && !s.planView);
  const building = useEditorStore((s) => s.building);
  const walls = useMemo(
    () => buildWalls(building.footprint, building.wallThickness, 1),
    [building.footprint, building.wallThickness],
  );
  if (!show) return null;
  return (
    <>
      {wallPhotoSlots(building).map((slot, edge) => {
        const wall = walls[edge];
        const photo = photos[slot];
        return wall && photo ? (
          <FacadePhoto key={slot} wall={wall} photo={photo} building={building} />
        ) : null;
      })}
    </>
  );
}

function FacadePhoto({ wall, photo, building }: { wall: Wall; photo: Photo; building: Building }) {
  const lit = useEditorStore((s) => s.highlightedWall === wall.index);
  const [texture, setTexture] = useState<Texture | null>(null);
  const opacity = useEditorStore((s) => 1 - s.facadePhotoTransparency / 100);
  useEffect(() => {
    let live = true;
    let loaded: Texture | null = null;
    new TextureLoader().load(photo.url, (t) => {
      t.colorSpace = SRGBColorSpace;
      loaded = t;
      if (live) setTexture(t);
      else t.dispose();
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, [photo.url]);

  // The straightened photo is 1 px = 1 cm, from the bottom left of the wall at the ground. It
  // may reach above the eaves (a gable) or differ a little from the model's wall length.
  const width = photo.width / WALL_PX_PER_METRE;
  const height = photo.height / WALL_PX_PER_METRE;
  // The photo ends where the solid building ends: at the top of the storey being edited (the
  // storeys above it are only outlines or hidden), so it never hangs in the air above the walls.
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const shown = useMemo(() => {
    if (!activeStoreyId) return height;
    let top = 0;
    for (const storey of building.storeys) {
      top += storey.height;
      if (storey.id === activeStoreyId) return Math.min(height, top);
    }
    return height;
  }, [activeStoreyId, building.storeys, height]);
  useEffect(() => {
    if (!texture) return;
    // The lower part of the picture only (texture v runs from the bottom).
    texture.repeat.set(1, shown / height);
  }, [texture, shown, height]);
  const cx = wall.outerA.x + (wall.direction.x * width) / 2 + wall.normal.x * OUT;
  const cz = wall.outerA.y + (wall.direction.y * width) / 2 + wall.normal.y * OUT;

  // Each opening of this wall as a rectangle in the photo's own coordinates, centre origin.
  const frames = useMemo(() => {
    const bases = building.storeys.map((_, i) =>
      building.storeys.slice(0, i).reduce((sum, s) => sum + s.height, 0),
    );
    return building.storeys.flatMap((storey, i) => {
      const base = bases[i] ?? 0;
      if (base >= shown - 1e-6) return [];
      return storey.openings
        .filter((o) => !o.interior && o.wallIndex === wall.index)
        .map((o) => {
          const x0 = o.offset - width / 2;
          const y0 = base + o.sill - height / 2;
          return {
            id: o.id,
            points: [
              [x0, y0, 0],
              [x0 + o.width, y0, 0],
              [x0 + o.width, y0 + o.height, 0],
              [x0, y0 + o.height, 0],
              [x0, y0, 0],
            ] as [number, number, number][],
          };
        });
    });
  }, [building.storeys, wall.index, width, height, shown]);

  if (!texture) return null;
  return (
    <group position={[cx, height / 2, cz]} rotation={[0, yawFor(wall.direction), 0]}>
      <mesh raycast={() => null} position={[0, (shown - height) / 2, 0]}>
        <planeGeometry args={[width, shown]} />
        <meshBasicMaterial
          map={texture}
          // Tinted selection blue while the wall's row in the layers tree is hovered.
          color={lit ? colors.accent : "#ffffff"}
          side={DoubleSide}
          toneMapped={false}
          transparent={opacity < 1}
          opacity={opacity}
          depthWrite={opacity >= 1}
        />
      </mesh>
      {frames.map((frame) => (
        // The plane's front faces inward, so "in front" of the photo, seen from outside, is -z.
        <group key={frame.id} position={[0, 0, -0.005]}>
          <Line points={frame.points} color={colors.accent} lineWidth={2} />
        </group>
      ))}
    </group>
  );
}
