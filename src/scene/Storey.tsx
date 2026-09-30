import { pieceRange } from "@/geometry/wallGraph";
import { useMemo } from "react";
import { openingsOn, validateOpening } from "@/geometry/openings";
import { buildWalls, interiorWallAsWall } from "@/geometry/walls";
import { interiorWallThickness } from "@/geometry/constructions";
import { effectiveWallThickness } from "@/geometry/layers";
import type { Building, Storey as StoreyData } from "@/geometry/types";
import { colors } from "@/lib/colors";
import { Opening } from "./Opening";
import { Room } from "./Room";
import { Wall } from "./Wall";
import { InteriorWall } from "./InteriorWall";
import { prismGeometry } from "./three";
import { Outline } from "./Outline";
import type { StoreyDisplay } from "./display";
import { StoreyHvac } from "./Hvac";
import { useDisposableGeometry } from "./useDisposableGeometry";

interface Props {
  building: Building;
  storey: StoreyData;
  elevation: number;
  active: boolean;
  display: StoreyDisplay;
  ghostOpacity: number;
}

const SLAB = 0.2;

export function Storey({ building, storey, elevation, active, display, ghostOpacity }: Props) {
  const thickness = effectiveWallThickness(building);
  const walls = useMemo(
    () => buildWalls(building.footprint, thickness, storey.height),
    [building.footprint, thickness, storey.height],
  );
  const slab = useMemo(
    () => prismGeometry(building.footprint, elevation - SLAB, elevation),
    [building.footprint, elevation],
  );
  useDisposableGeometry(slab);
  const zones = useMemo(() => new Map(building.zones.map((z) => [z.id, z])), [building.zones]);

  return (
    <group>
      {display === "outline" ? (
        <Outline geometry={slab} />
      ) : (
        <mesh geometry={slab} receiveShadow raycast={() => null}>
          <meshStandardMaterial
            color={colors.floor}
            roughness={1}
            transparent={display === "ghost"}
            opacity={display === "ghost" ? ghostOpacity : 1}
            depthWrite={display !== "ghost"}
          />
        </mesh>
      )}
      {walls.map((wall) => {
        const onWall = openingsOn(storey.openings, wall.index);
        return (
          <group key={wall.index}>
            <Wall
              storeyId={storey.id}
              wall={wall}
              openings={onWall}
              elevation={elevation}
              active={active}
              display={display}
              ghostOpacity={ghostOpacity}
            />
            {onWall.map((opening) => (
              <Opening
                key={opening.id}
                storeyId={storey.id}
                wall={wall}
                opening={opening}
                thickness={thickness}
                elevation={elevation}
                active={active}
                display={display}
                ghostOpacity={ghostOpacity}
                valid={
                  validateOpening(opening, {
                    wallLength: wall.length,
                    storeyHeight: storey.height,
                    siblings: onWall,
                  }).length === 0
                }
              />
            ))}
          </group>
        );
      })}
      {storey.interiorWalls.map((segment, index) => {
        // Built only where it is seen, like the plan draws it: not into the walls it meets.
        const pieces = {
          footprint: building.footprint,
          exteriorThickness: effectiveWallThickness(building),
          thicknessOf: interiorWallThickness(building.constructions),
        };
        const thickness = pieces.thicknessOf(segment);
        const onWall = openingsOn(storey.openings, index, true);
        const wall = interiorWallAsWall(segment, index, storey.height, thickness);
        return (
          <group key={index}>
            <InteriorWall
              storeyId={storey.id}
              index={index}
              segment={segment}
              openings={onWall}
              height={storey.height}
              thickness={thickness}
              range={pieceRange(index, storey.interiorWalls, pieces)}
              elevation={elevation}
              active={active}
              display={display}
              ghostOpacity={ghostOpacity}
            />
            {onWall.map((opening) => (
              <Opening
                key={opening.id}
                storeyId={storey.id}
                wall={wall}
                opening={opening}
                thickness={thickness}
                elevation={elevation}
                active={active}
                display={display}
                ghostOpacity={ghostOpacity}
                valid={
                  validateOpening(opening, {
                    wallLength: wall.length,
                    storeyHeight: storey.height,
                    siblings: onWall,
                  }).length === 0
                }
              />
            ))}
          </group>
        );
      })}
      <StoreyHvac
        building={building}
        storey={storey}
        elevation={elevation}
        active={active}
        display={display}
        ghostOpacity={ghostOpacity}
      />
      {storey.rooms.map((room) => (
        <Room
          key={room.id}
          storeyId={storey.id}
          room={room}
          zone={room.zoneId === undefined ? undefined : zones.get(room.zoneId)}
          elevation={elevation}
          active={active}
          display={display}
          ghostOpacity={ghostOpacity}
        />
      ))}
    </group>
  );
}
