/**
 * IFC4 export as a STEP physical file, written by hand.
 *
 * Spatial structure (IfcRelAggregates, top down):
 *   IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey > IfcSpace
 * Elements are placed in storeys with IfcRelContainedInSpatialStructure:
 *   IfcWall (exterior, PredefinedType SOLIDWALL; interior, PARTITIONING)
 *   IfcSlab (FLOOR under each storey, ROOF over the top one)
 *   IfcWindow, IfcDoor, each filling an IfcOpeningElement that voids its wall
 *   (IfcRelVoidsElement, IfcRelFillsElement)
 * Zones: IfcZone groups its IfcSpaces through IfcRelAssignsToGroup.
 * Geometry: every solid is an IfcExtrudedAreaSolid over an
 * IfcArbitraryClosedProfileDef (IfcPolyline of IfcCartesianPoint 2D),
 * extruded along +Z. Placements are relative: storey placement carries the
 * elevation, element placements inside a storey are identity, so profile
 * coordinates are the plan coordinates in metres.
 * Axes: the editor's plan (x, y) maps to IFC (X, Y) and height maps to Z.
 * Units: metres, square metres, cubic metres, radians.
 * Property sets: Pset_WallCommon, Pset_WindowCommon, Pset_DoorCommon with
 * IsExternal and ThermalTransmittance; Pset_SpaceCommon with NetPlannedArea.
 */
import { findConstruction, interiorWallThickness } from "./constructions";
import { effectiveWallThickness } from "./layers";
import { buildRoof } from "./roof";
import { evaluateAll } from "./scenarios";
import { epsgForZone, northInPlan, toUtm } from "./geo";
import { openingsOn, validateOpening } from "./openings";
import { area, sub } from "./polygon";
import { NULL, DERIVED, StepWriter, bool, enm, ifcGuid, list, real, ref, str, typed } from "./step";
import type { Attr } from "./step";
import type { Building, Opening, Room, Storey, Vec2 } from "./types";
import { buildWalls, interiorWallAsWall } from "./walls";
import type { Wall } from "./walls";

export interface IfcOptions {
  /** ISO timestamp for the header. Defaults to now. */
  timestamp?: string;
  author?: string;
  fileName?: string;
}

const SLAB_THICKNESS = 0.2;
const WINDOW_THICKNESS = 0.05;

interface Context {
  w: StepWriter;
  bodyContext: number;
  zUp: number;
  xAxis: number;
  origin3d: number;
}

export function toIfc(building: Building, options: IfcOptions = {}): string {
  const w = new StepWriter();
  const guid = (s: string) => str(ifcGuid(s));

  // Units and representation context.
  const lengthUnit = w.add("IFCSIUNIT", [DERIVED, enm("LENGTHUNIT"), NULL, enm("METRE")]);
  const areaUnit = w.add("IFCSIUNIT", [DERIVED, enm("AREAUNIT"), NULL, enm("SQUARE_METRE")]);
  const volumeUnit = w.add("IFCSIUNIT", [DERIVED, enm("VOLUMEUNIT"), NULL, enm("CUBIC_METRE")]);
  const angleUnit = w.add("IFCSIUNIT", [DERIVED, enm("PLANEANGLEUNIT"), NULL, enm("RADIAN")]);
  const units = w.add("IFCUNITASSIGNMENT", [
    list([lengthUnit, areaUnit, volumeUnit, angleUnit].map(ref)),
  ]);

  const origin3d = w.add("IFCCARTESIANPOINT", [list([real(0), real(0), real(0)])]);
  const zUp = w.add("IFCDIRECTION", [list([real(0), real(0), real(1)])]);
  const xAxis = w.add("IFCDIRECTION", [list([real(1), real(0), real(0)])]);
  const worldPlacement = w.add("IFCAXIS2PLACEMENT3D", [ref(origin3d), ref(zUp), ref(xAxis)]);
  const modelContext = w.add("IFCGEOMETRICREPRESENTATIONCONTEXT", [
    NULL,
    str("Model"),
    "3",
    real(1e-5),
    ref(worldPlacement),
    NULL,
  ]);
  const bodyContext = w.add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", [
    str("Body"),
    str("Model"),
    DERIVED,
    DERIVED,
    DERIVED,
    DERIVED,
    ref(modelContext),
    NULL,
    enm("MODEL_VIEW"),
    NULL,
  ]);
  const ctx: Context = { w, bodyContext, zUp, xAxis, origin3d };

  // Georeferencing (IFC4 Add2): the model origin in a projected CRS plus the
  // direction of the model's X axis, given as (XAxisAbscissa, XAxisOrdinate).
  if (building.origin) {
    const utm = toUtm(building.origin);
    const crs = w.add("IFCPROJECTEDCRS", [
      str(`EPSG:${epsgForZone(utm.zone)}`),
      str(`ETRS89 / UTM zone ${utm.zone}N`),
      str("ETRS89"),
      NULL,
      str("UTM"),
      str(`Zone ${utm.zone}N`),
      ref(lengthUnit),
    ]);
    // Model +y points to compass `rotation` degrees; model +x is 90 degrees clockwise of it.
    const north = northInPlan(building.origin);
    const xAbscissa = north.y; // cos(rotation)
    const xOrdinate = north.x; // -sin(rotation), north component of model +x
    w.add("IFCMAPCONVERSION", [
      ref(modelContext),
      ref(crs),
      real(utm.easting),
      real(utm.northing),
      real(0),
      real(xAbscissa),
      real(xOrdinate),
      real(1),
    ]);
  }

  // Spatial structure.
  const project = w.add("IFCPROJECT", [
    guid(`${building.id}/project`),
    NULL,
    str(building.name),
    NULL,
    NULL,
    NULL,
    NULL,
    list([ref(modelContext)]),
    ref(units),
  ]);
  const sitePlacement = localPlacement(ctx, null, 0);
  const site = w.add("IFCSITE", [
    guid(`${building.id}/site`),
    NULL,
    str("Site"),
    NULL,
    NULL,
    ref(sitePlacement),
    NULL,
    NULL,
    enm("ELEMENT"),
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
  ]);
  const buildingPlacement = localPlacement(ctx, sitePlacement, 0);
  const ifcBuilding = w.add("IFCBUILDING", [
    guid(`${building.id}/building`),
    NULL,
    str(building.name),
    NULL,
    NULL,
    ref(buildingPlacement),
    NULL,
    NULL,
    enm("ELEMENT"),
    NULL,
    NULL,
    NULL,
  ]);
  w.add("IFCRELAGGREGATES", [
    guid(`${building.id}/agg-project`),
    NULL,
    NULL,
    NULL,
    ref(project),
    list([ref(site)]),
  ]);
  w.add("IFCRELAGGREGATES", [
    guid(`${building.id}/agg-site`),
    NULL,
    NULL,
    NULL,
    ref(site),
    list([ref(ifcBuilding)]),
  ]);

  const storeyIds: number[] = [];
  const spacesByZone = new Map<string, number[]>();
  let elevation = 0;

  building.storeys.forEach((storey, index) => {
    const storeyPlacement = localPlacement(ctx, buildingPlacement, elevation);
    const ifcStorey = w.add("IFCBUILDINGSTOREY", [
      guid(storey.id),
      NULL,
      str(storey.name),
      NULL,
      NULL,
      ref(storeyPlacement),
      NULL,
      NULL,
      enm("ELEMENT"),
      real(elevation),
    ]);
    storeyIds.push(ifcStorey);
    const contained: number[] = [];
    const walls = buildWalls(building.footprint, effectiveWallThickness(building), storey.height);
    const wallU = findConstruction(building.constructions, building.wallConstructionId)?.uValue;

    const wallLayerSet = materialLayerSet(ctx, building, building.wallConstructionId);
    // Exterior walls with their openings.
    for (const wall of walls) {
      const placement = localPlacement(ctx, storeyPlacement, 0);
      const solid = extrudedSolid(ctx, wall.quad, 0, storey.height);
      const ifcWall = w.add("IFCWALL", [
        guid(`${storey.id}/wall/${wall.index}`),
        NULL,
        str(`Wall ${wall.index + 1}`),
        NULL,
        NULL,
        ref(placement),
        ref(shape(ctx, solid)),
        NULL,
        enm("SOLIDWALL"),
      ]);
      contained.push(ifcWall);
      if (wallLayerSet !== null) {
        const usage = w.add("IFCMATERIALLAYERSETUSAGE", [
          ref(wallLayerSet),
          enm("AXIS2"),
          enm("NEGATIVE"),
          real(0),
          NULL,
        ]);
        w.add("IFCRELASSOCIATESMATERIAL", [
          guid(`${storey.id}/wall/${wall.index}/mat`),
          NULL,
          NULL,
          NULL,
          list([ref(ifcWall)]),
          ref(usage),
        ]);
      }
      propertySet(
        ctx,
        `${storey.id}/wall/${wall.index}/pset`,
        "Pset_WallCommon",
        [ifcWall],
        [
          ["IsExternal", typed("IFCBOOLEAN", bool(true))],
          ...(wallU === undefined
            ? []
            : [
                ["ThermalTransmittance", typed("IFCTHERMALTRANSMITTANCEMEASURE", real(wallU))] as [
                  string,
                  Attr,
                ],
              ]),
        ],
      );

      const onWall = openingsOn(storey.openings, wall.index);
      for (const opening of onWall) {
        const valid =
          validateOpening(opening, {
            wallLength: wall.length,
            storeyHeight: storey.height,
            siblings: onWall,
          }).length === 0;
        if (!valid) continue;
        const filled = addOpening(ctx, building, storeyPlacement, wall, opening, ifcWall);
        contained.push(filled);
      }
    }

    // Interior walls.
    const thicknessOf = interiorWallThickness(building.constructions);
    storey.interiorWalls.forEach((segment, i) => {
      const wall = interiorWallAsWall(segment, i, storey.height, thicknessOf(segment));
      const placement = localPlacement(ctx, storeyPlacement, 0);
      const solid = extrudedSolid(ctx, wall.quad, 0, storey.height);
      const ifcWall = w.add("IFCWALL", [
        guid(
          `${storey.id}/interior/${i}/${segment.a.x},${segment.a.y},${segment.b.x},${segment.b.y}`,
        ),
        NULL,
        str(`Interior wall ${i + 1}`),
        NULL,
        NULL,
        ref(placement),
        ref(shape(ctx, solid)),
        NULL,
        enm("PARTITIONING"),
      ]);
      contained.push(ifcWall);
      propertySet(
        ctx,
        `${storey.id}/interior/${i}/pset`,
        "Pset_WallCommon",
        [ifcWall],
        [["IsExternal", typed("IFCBOOLEAN", bool(false))]],
      );
      const onWall = openingsOn(storey.openings, i, true);
      for (const opening of onWall) {
        if (
          validateOpening(opening, {
            wallLength: wall.length,
            storeyHeight: storey.height,
            siblings: onWall,
          }).length > 0
        )
          continue;
        contained.push(addOpening(ctx, building, storeyPlacement, wall, opening, ifcWall, false));
      }
    });

    // Heating: radiators as IfcSpaceHeater on the inner wall face, pipe runs as IfcPipeSegment per leg.
    for (const rad of storey.radiators ?? []) {
      const wall = walls[rad.wallIndex];
      if (!wall) continue;
      const t = effectiveWallThickness(building);
      const plan = wallRect(wall, rad.offset, rad.offset + rad.width, t + 0.01, t + 0.11);
      const heater = w.add("IFCSPACEHEATER", [
        guid(rad.id),
        NULL,
        str("Radiator"),
        NULL,
        NULL,
        ref(localPlacement(ctx, storeyPlacement, 0)),
        ref(shape(ctx, extrudedSolid(ctx, plan, 0.15, 0.15 + rad.height))),
        NULL,
        enm("RADIATOR"),
      ]);
      contained.push(heater);
      propertySet(
        ctx,
        `${rad.id}/pset`,
        "Pset_SpaceHeaterTypeCommon",
        [heater],
        [["OutputCapacity", typed("IFCPOWERMEASURE", real(rad.power))]],
      );
    }
    for (const pipe of storey.pipes ?? []) {
      for (let i = 1; i < pipe.points.length; i++) {
        const a = pipe.points[i - 1];
        const b = pipe.points[i];
        if (!a || !b) continue;
        const plan = thickSegment(a, b, 0.05);
        const seg = w.add("IFCPIPESEGMENT", [
          guid(`${pipe.id}/${i}`),
          NULL,
          str("Pipe"),
          NULL,
          NULL,
          ref(localPlacement(ctx, storeyPlacement, 0)),
          ref(shape(ctx, extrudedSolid(ctx, plan, 0.02, 0.07))),
          NULL,
          enm("RIGIDSEGMENT"),
        ]);
        contained.push(seg);
      }
    }

    // Floor slab under the storey, roof slab over the top storey.
    const floorPlacement = localPlacement(ctx, storeyPlacement, 0);
    const floor = w.add("IFCSLAB", [
      guid(`${storey.id}/floor`),
      NULL,
      str(`Floor ${storey.name}`),
      NULL,
      NULL,
      ref(floorPlacement),
      ref(shape(ctx, extrudedSolid(ctx, building.footprint, -SLAB_THICKNESS, 0))),
      NULL,
      enm("FLOOR"),
    ]);
    contained.push(floor);
    if (index === building.storeys.length - 1) {
      const roofPlacement = localPlacement(ctx, storeyPlacement, 0);
      const roof = w.add("IFCSLAB", [
        guid(`${storey.id}/roof`),
        NULL,
        str("Roof"),
        NULL,
        NULL,
        ref(roofPlacement),
        ref(
          shape(
            ctx,
            extrudedSolid(ctx, building.footprint, storey.height, storey.height + SLAB_THICKNESS),
          ),
        ),
        NULL,
        enm("ROOF"),
      ]);
      contained.push(roof);
    }

    // Spaces aggregate to the storey.
    const spaces: number[] = [];
    for (const room of storey.rooms) {
      const space = addSpace(ctx, storey, storeyPlacement, room);
      spaces.push(space);
      if (room.zoneId !== undefined) {
        const listForZone = spacesByZone.get(room.zoneId) ?? [];
        listForZone.push(space);
        spacesByZone.set(room.zoneId, listForZone);
      }
    }
    if (spaces.length > 0) {
      w.add("IFCRELAGGREGATES", [
        guid(`${storey.id}/agg-spaces`),
        NULL,
        NULL,
        NULL,
        ref(ifcStorey),
        list(spaces.map(ref)),
      ]);
    }
    if (contained.length > 0) {
      w.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [
        guid(`${storey.id}/contains`),
        NULL,
        NULL,
        NULL,
        list(contained.map(ref)),
        ref(ifcStorey),
      ]);
    }
    elevation += storey.height;
  });

  // Pitched roof as an IfcRoof with one IfcSlab ROOF member per face, each a surface model.
  const roofGeo = buildRoof(building, 0);
  const lastStoreyIfc = storeyIds[storeyIds.length - 1];
  if (roofGeo.builtKind !== "flat" && lastStoreyIfc !== undefined) {
    const roofPlacement = localPlacement(ctx, buildingPlacement, elevation);
    const ifcRoof = w.add("IFCROOF", [
      guid(`${building.id}/roof`),
      NULL,
      str("Roof"),
      NULL,
      NULL,
      ref(roofPlacement),
      NULL,
      NULL,
      enm(roofGeo.builtKind === "hip" ? "HIP_ROOF" : "GABLE_ROOF"),
    ]);
    const members = roofGeo.faces.map((f, i) => {
      const pts = f.points.map((p) =>
        w.add("IFCCARTESIANPOINT", [list([real(p.x), real(p.y), real(p.z)])]),
      );
      const loop = w.add("IFCPOLYLOOP", [list(pts.map(ref))]);
      const bound = w.add("IFCFACEOUTERBOUND", [ref(loop), bool(true)]);
      const ifcFace = w.add("IFCFACE", [list([ref(bound)])]);
      const shell = w.add("IFCOPENSHELL", [list([ref(ifcFace)])]);
      const model = w.add("IFCSHELLBASEDSURFACEMODEL", [list([ref(shell)])]);
      const rep = w.add("IFCSHAPEREPRESENTATION", [
        ref(bodyContext),
        str("Body"),
        str("SurfaceModel"),
        list([ref(model)]),
      ]);
      const shapeRep = w.add("IFCPRODUCTDEFINITIONSHAPE", [NULL, NULL, list([ref(rep)])]);
      return w.add("IFCSLAB", [
        guid(`${building.id}/roof/face/${i}`),
        NULL,
        str(`Roof face ${i + 1}`),
        NULL,
        NULL,
        ref(localPlacement(ctx, roofPlacement, 0)),
        ref(shapeRep),
        NULL,
        enm("ROOF"),
      ]);
    });
    w.add("IFCRELAGGREGATES", [
      guid(`${building.id}/roof/agg`),
      NULL,
      NULL,
      NULL,
      ref(ifcRoof),
      list(members.map(ref)),
    ]);
    w.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [
      guid(`${building.id}/roof/contains`),
      NULL,
      NULL,
      NULL,
      list([ref(ifcRoof)]),
      ref(lastStoreyIfc),
    ]);
    const total = w.add("IFCPROPERTYSINGLEVALUE", [
      str("TotalArea"),
      NULL,
      typed("IFCAREAMEASURE", real(roofGeo.area)),
      NULL,
    ]);
    const projected = w.add("IFCPROPERTYSINGLEVALUE", [
      str("ProjectedArea"),
      NULL,
      typed("IFCAREAMEASURE", real(area(building.footprint))),
      NULL,
    ]);
    const pset = w.add("IFCPROPERTYSET", [
      guid(`${building.id}/roof/pset`),
      NULL,
      str("Pset_RoofCommon"),
      NULL,
      list([ref(total), ref(projected)]),
    ]);
    w.add("IFCRELDEFINESBYPROPERTIES", [
      guid(`${building.id}/roof/pset/rel`),
      NULL,
      NULL,
      NULL,
      list([ref(ifcRoof)]),
      ref(pset),
    ]);
  }

  if (storeyIds.length > 0) {
    w.add("IFCRELAGGREGATES", [
      guid(`${building.id}/agg-building`),
      NULL,
      NULL,
      NULL,
      ref(ifcBuilding),
      list(storeyIds.map(ref)),
    ]);
  }

  // Heat pumps stand on the site.
  const firstStorey = storeyIds[0];
  for (const pump of building.heatPumps ?? []) {
    const h = pump.kind === "air" ? 1.3 : 0.9;
    const plan = [
      { x: pump.position.x - 0.5, y: pump.position.y - 0.2 },
      { x: pump.position.x + 0.5, y: pump.position.y - 0.2 },
      { x: pump.position.x + 0.5, y: pump.position.y + 0.2 },
      { x: pump.position.x - 0.5, y: pump.position.y + 0.2 },
    ];
    const unit = w.add("IFCUNITARYEQUIPMENT", [
      guid(pump.id),
      NULL,
      str("Heat pump"),
      NULL,
      NULL,
      ref(localPlacement(ctx, buildingPlacement, 0)),
      ref(shape(ctx, extrudedSolid(ctx, plan, 0, h))),
      NULL,
      enm("AIRHANDLER"),
    ]);
    if (firstStorey !== undefined) {
      w.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [
        guid(`${pump.id}/contains`),
        NULL,
        NULL,
        NULL,
        list([ref(unit)]),
        ref(firstStorey),
      ]);
    }
    propertySet(
      ctx,
      `${pump.id}/pset`,
      "Pset_UnitaryEquipmentTypeCommon",
      [unit],
      [["NominalHeatingCapacity", typed("IFCPOWERMEASURE", real(pump.power * 1000))]],
    );
  }

  // Renovation scenarios as a property set on the building: demand and class per variant.
  const scenarioResults = evaluateAll(building);
  if (scenarioResults.length > 0) {
    const props = scenarioResults.flatMap((r) => [
      w.add("IFCPROPERTYSINGLEVALUE", [
        str(`${r.scenario.name}: heating demand`),
        NULL,
        typed("IFCENERGYMEASURE", real(r.energy.heatingDemand * 3.6e6)),
        NULL,
      ]),
      w.add("IFCPROPERTYSINGLEVALUE", [
        str(`${r.scenario.name}: class`),
        NULL,
        typed("IFCLABEL", str(r.energy.energyClass ?? "")),
        NULL,
      ]),
      w.add("IFCPROPERTYSINGLEVALUE", [
        str(`${r.scenario.name}: investment EUR`),
        NULL,
        typed("IFCREAL", real(r.investment)),
        NULL,
      ]),
    ]);
    const pset = w.add("IFCPROPERTYSET", [
      guid(`${building.id}/scenarios`),
      NULL,
      str("Bauwerk_RenovationScenarios"),
      NULL,
      list(props.map(ref)),
    ]);
    w.add("IFCRELDEFINESBYPROPERTIES", [
      guid(`${building.id}/scenarios/rel`),
      NULL,
      NULL,
      NULL,
      list([ref(ifcBuilding)]),
      ref(pset),
    ]);
  }

  // Zones.
  for (const zone of building.zones) {
    const spaces = spacesByZone.get(zone.id) ?? [];
    const ifcZone = w.add("IFCZONE", [guid(zone.id), NULL, str(zone.name), NULL, NULL, NULL]);
    if (spaces.length > 0) {
      w.add("IFCRELASSIGNSTOGROUP", [
        guid(`${zone.id}/assign`),
        NULL,
        NULL,
        NULL,
        list(spaces.map(ref)),
        NULL,
        ref(ifcZone),
      ]);
    }
  }

  return w.toString({
    description: "ViewDefinition [ReferenceView_V1.2]",
    fileName: options.fileName ?? `${building.name}.ifc`,
    timestamp: options.timestamp ?? new Date().toISOString().slice(0, 19),
    author: options.author ?? "",
    organization: "",
    preprocessor: "Bauwerk",
    originatingSystem: "Bauwerk",
    authorization: "",
    schema: "IFC4",
  });
}

/**
 * IfcMaterialLayerSet for a layered construction, written once per export and
 * shared by every wall through IfcMaterialLayerSetUsage. Each layer carries its
 * material with Pset_MaterialThermal ThermalConductivity. Returns null for a
 * construction without layers.
 */
const layerSetCache = new WeakMap<Context, Map<string, number | null>>();
function materialLayerSet(ctx: Context, building: Building, constructionId: string): number | null {
  const cache = layerSetCache.get(ctx) ?? new Map<string, number | null>();
  layerSetCache.set(ctx, cache);
  const hit = cache.get(constructionId);
  if (hit !== undefined) return hit;
  const c = findConstruction(building.constructions, constructionId);
  if (!c?.layers || c.layers.length === 0) {
    cache.set(constructionId, null);
    return null;
  }
  const w = ctx.w;
  const layerIds = c.layers.map((l) => {
    const material = w.add("IFCMATERIAL", [str(l.name || "Layer"), NULL, NULL]);
    const conductivity = w.add("IFCPROPERTYSINGLEVALUE", [
      str("ThermalConductivity"),
      NULL,
      typed("IFCTHERMALCONDUCTIVITYMEASURE", real(l.conductivity)),
      NULL,
    ]);
    w.add("IFCMATERIALPROPERTIES", [
      str("Pset_MaterialThermal"),
      NULL,
      list([ref(conductivity)]),
      ref(material),
    ]);
    return w.add("IFCMATERIALLAYER", [
      ref(material),
      real(l.thickness),
      NULL,
      str(l.name || "Layer"),
      NULL,
      NULL,
      NULL,
    ]);
  });
  const set = w.add("IFCMATERIALLAYERSET", [list(layerIds.map(ref)), str(c.name), NULL]);
  cache.set(constructionId, set);
  return set;
}

function localPlacement(ctx: Context, parent: number | null, z: number): number {
  const point =
    z === 0 ? ctx.origin3d : ctx.w.add("IFCCARTESIANPOINT", [list([real(0), real(0), real(z)])]);
  const axis = ctx.w.add("IFCAXIS2PLACEMENT3D", [ref(point), ref(ctx.zUp), ref(ctx.xAxis)]);
  return ctx.w.add("IFCLOCALPLACEMENT", [parent === null ? NULL : ref(parent), ref(axis)]);
}

/** Vertical extrusion of a plan polygon from `bottom` to `top`, relative to its placement. */
function extrudedSolid(ctx: Context, plan: readonly Vec2[], bottom: number, top: number): number {
  const w = ctx.w;
  const points = plan.map((p) => w.add("IFCCARTESIANPOINT", [list([real(p.x), real(p.y)])]));
  const first = points[0];
  const polyline = w.add("IFCPOLYLINE", [
    list([...points, ...(first === undefined ? [] : [first])].map(ref)),
  ]);
  const profile = w.add("IFCARBITRARYCLOSEDPROFILEDEF", [enm("AREA"), NULL, ref(polyline)]);
  const base =
    bottom === 0
      ? ctx.origin3d
      : w.add("IFCCARTESIANPOINT", [list([real(0), real(0), real(bottom)])]);
  const position = w.add("IFCAXIS2PLACEMENT3D", [ref(base), ref(ctx.zUp), ref(ctx.xAxis)]);
  return w.add("IFCEXTRUDEDAREASOLID", [
    ref(profile),
    ref(position),
    ref(ctx.zUp),
    real(top - bottom),
  ]);
}

function shape(ctx: Context, solid: number): number {
  const rep = ctx.w.add("IFCSHAPEREPRESENTATION", [
    ref(ctx.bodyContext),
    str("Body"),
    str("SweptSolid"),
    list([ref(solid)]),
  ]);
  return ctx.w.add("IFCPRODUCTDEFINITIONSHAPE", [NULL, NULL, list([ref(rep)])]);
}

function propertySet(
  ctx: Context,
  key: string,
  name: string,
  elements: number[],
  props: [string, Attr][],
): void {
  if (props.length === 0) return;
  const w = ctx.w;
  const ids = props.map(([n, v]) => w.add("IFCPROPERTYSINGLEVALUE", [str(n), NULL, v, NULL]));
  const pset = w.add("IFCPROPERTYSET", [
    str(ifcGuid(key)),
    NULL,
    str(name),
    NULL,
    list(ids.map(ref)),
  ]);
  w.add("IFCRELDEFINESBYPROPERTIES", [
    str(ifcGuid(`${key}/rel`)),
    NULL,
    NULL,
    NULL,
    list(elements.map(ref)),
    ref(pset),
  ]);
}

/** Rectangle of `thickness` centred on the segment. */
function thickSegment(a: Vec2, b: Vec2, thickness: number): Vec2[] {
  const d = sub(b, a);
  const len = Math.hypot(d.x, d.y) || 1;
  const n = { x: (-d.y / len) * (thickness / 2), y: (d.x / len) * (thickness / 2) };
  return [
    { x: a.x + n.x, y: a.y + n.y },
    { x: b.x + n.x, y: b.y + n.y },
    { x: b.x - n.x, y: b.y - n.y },
    { x: a.x - n.x, y: a.y - n.y },
  ];
}

/** Rectangle in the wall between u0 and u1, from `from` to `to` along the inward normal (0 is the outer face). */
function wallRect(wall: Wall, u0: number, u1: number, from: number, to: number): Vec2[] {
  const at = (u: number, depth: number): Vec2 => ({
    x: wall.outerA.x + wall.direction.x * u - wall.normal.x * depth,
    y: wall.outerA.y + wall.direction.y * u - wall.normal.y * depth,
  });
  return [at(u0, from), at(u1, from), at(u1, to), at(u0, to)];
}

function addOpening(
  ctx: Context,
  building: Building,
  storeyPlacement: number,
  wall: Wall,
  opening: Opening,
  ifcWall: number,
  isExternal = true,
): number {
  const w = ctx.w;
  const t = effectiveWallThickness(building);
  const u0 = opening.offset;
  const u1 = opening.offset + opening.width;
  const openingPlan = wallRect(wall, u0, u1, -0.01, t + 0.01);
  const openingPlacement = localPlacement(ctx, storeyPlacement, 0);
  const ifcOpening = w.add("IFCOPENINGELEMENT", [
    str(ifcGuid(`${opening.id}/opening`)),
    NULL,
    str("Opening"),
    NULL,
    NULL,
    ref(openingPlacement),
    ref(shape(ctx, extrudedSolid(ctx, openingPlan, opening.sill, opening.sill + opening.height))),
    NULL,
    enm("OPENING"),
  ]);
  w.add("IFCRELVOIDSELEMENT", [
    str(ifcGuid(`${opening.id}/voids`)),
    NULL,
    NULL,
    NULL,
    ref(ifcWall),
    ref(ifcOpening),
  ]);

  const fillPlan = wallRect(
    wall,
    u0,
    u1,
    t / 2 - WINDOW_THICKNESS / 2,
    t / 2 + WINDOW_THICKNESS / 2,
  );
  const fillPlacement = localPlacement(ctx, storeyPlacement, 0);
  const fillShape = shape(
    ctx,
    extrudedSolid(ctx, fillPlan, opening.sill, opening.sill + opening.height),
  );
  const isDoor = opening.kind === "door";
  const filled = w.add(isDoor ? "IFCDOOR" : "IFCWINDOW", [
    str(ifcGuid(opening.id)),
    NULL,
    str(isDoor ? "Door" : "Window"),
    NULL,
    NULL,
    ref(fillPlacement),
    ref(fillShape),
    NULL,
    real(opening.height),
    real(opening.width),
    enm(isDoor ? "DOOR" : "WINDOW"),
    NULL,
    NULL,
  ]);
  w.add("IFCRELFILLSELEMENT", [
    str(ifcGuid(`${opening.id}/fills`)),
    NULL,
    NULL,
    NULL,
    ref(ifcOpening),
    ref(filled),
  ]);
  const u = findConstruction(building.constructions, opening.constructionId)?.uValue;
  propertySet(
    ctx,
    `${opening.id}/pset`,
    isDoor ? "Pset_DoorCommon" : "Pset_WindowCommon",
    [filled],
    [
      ["IsExternal", typed("IFCBOOLEAN", bool(isExternal))],
      ...(u === undefined
        ? []
        : [
            ["ThermalTransmittance", typed("IFCTHERMALTRANSMITTANCEMEASURE", real(u))] as [
              string,
              Attr,
            ],
          ]),
    ],
  );
  return filled;
}

function addSpace(ctx: Context, storey: Storey, storeyPlacement: number, room: Room): number {
  const w = ctx.w;
  const placement = localPlacement(ctx, storeyPlacement, 0);
  const space = w.add("IFCSPACE", [
    str(ifcGuid(room.id)),
    NULL,
    str(room.name),
    NULL,
    NULL,
    ref(placement),
    ref(shape(ctx, extrudedSolid(ctx, room.polygon, 0, storey.height))),
    str(room.name),
    enm("ELEMENT"),
    enm("INTERNAL"),
    NULL,
  ]);
  propertySet(
    ctx,
    `${room.id}/pset`,
    "Pset_SpaceCommon",
    [space],
    [["NetPlannedArea", typed("IFCAREAMEASURE", real(area(room.polygon)))]],
  );
  return space;
}
