import { useMemo } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { centroid } from "@/geometry/polygon";
import type { Id, Room as RoomData, Zone } from "@/geometry/types";
import { colors } from "@/lib/colors";
import type { StoreyDisplay } from "./display";
import { formatArea } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { useHover, useMarked } from "./hover";
import { flatGeometry, meshRaycast, noRaycast } from "./three";
import { useDisposableGeometry } from "./useDisposableGeometry";

interface Props {
  storeyId: Id;
  room: RoomData;
  zone: Zone | undefined;
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}

/** Flat fill on the floor, coloured by zone, with a label facing the camera. */
export function Room({ storeyId, room, zone, elevation, active, display, ghostOpacity }: Props) {
  const target: Selection = useMemo(
    () => ({ kind: "room", storeyId, id: room.id }),
    [storeyId, room.id],
  );
  const { selected, hovered } = useMarked(target);
  const language = useEditorStore((s) => s.language);
  const select = useEditorStore((s) => s.select);
  const tool = useEditorStore((s) => s.tool);
  // The floor plan writes its own room stamp, with the room's size; two would overlap.
  const planView = useEditorStore((s) => s.planView);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  const assignRoomToZone = useEditorStore((s) => s.assignRoomToZone);
  const hover = useHover(target, active);

  const hash = JSON.stringify(room.polygon);
  const geometry = useMemo(
    () => flatGeometry(room.polygon, elevation + 0.012),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hash, elevation],
  );
  useDisposableGeometry(geometry);
  const centre = useMemo(() => centroid(room.polygon), [hash]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!active) return;
    if (tool !== "select" && tool !== "zone") return;
    // Only when the floor is what was clicked. A room reaches under its walls (it is stored
    // out to their outer face and centre lines), and a wall selects itself on pointer up, so
    // the click that follows must not fall through to the room and select it instead.
    if (e.intersections[0]?.eventObject !== e.eventObject) return;
    e.stopPropagation();
    select(target);
    if (tool === "zone" && activeZoneId !== null) {
      assignRoomToZone(storeyId, room.id, room.zoneId === activeZoneId ? undefined : activeZoneId);
    }
  };

  const fill = zone?.color ?? colors.floor;
  const baseOpacity = zone ? 0.55 : 0.001;
  const highlightedOpacity = hovered || selected ? Math.max(baseOpacity, 0.35) : baseOpacity;
  const opacity = display === "ghost" ? highlightedOpacity * ghostOpacity : highlightedOpacity;

  if (display === "outline") return null;
  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={onClick}
        raycast={active && (tool === "select" || tool === "zone") ? meshRaycast : noRaycast}
        {...hover}
      >
        <meshStandardMaterial
          color={selected ? colors.accent : fill}
          transparent
          opacity={opacity}
          depthWrite={false}
          roughness={1}
        />
      </mesh>
      {active && !planView && (
        <Html
          position={[centre.x, elevation + 0.05, centre.y]}
          center
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex flex-col items-center rounded-inner border border-line bg-paper/90 px-2.5 py-1 text-center select-none"
            style={{ whiteSpace: "nowrap" }}
          >
            <div className="text-xs font-medium text-ink whitespace-nowrap">{room.name}</div>
            <div className="font-num text-xs text-muted whitespace-nowrap">
              {formatArea(room.area, language)}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
