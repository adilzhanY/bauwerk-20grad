import { totalThickness, uValueFromLayers } from "./layers";
import type { Construction, ConstructionKind, Id, Layer, ThicknessOf } from "./types";

/**
 * Default construction presets. Ids are stable so files written before the
 * energy layer existed can be migrated onto them. The typed U-values are the
 * fallback for presets without a layer stack (windows and doors); layered presets
 * take their U from the stack. The stacks are chosen so the result lands on the
 * typical values of the IWU building typology for the German stock: solid brick
 * wall about 1.5, uninsulated roof and floor slab about 1.5 to 1.7, aerated
 * concrete wall of the 1970s about 0.75 W/(m²K). Starting points, not survey data.
 */
export const PRESET_IDS = {
  wallBrick: "c_wall_brick",
  wall1970: "c_wall_1970",
  wallInsulated: "c_wall_insulated",
  glazingSingle: "c_glazing_single",
  glazingDouble: "c_glazing_double",
  glazingTriple: "c_glazing_triple",
  doorOld: "c_door_old",
  doorInsulated: "c_door_insulated",
  floorBare: "c_floor_bare",
  floorInsulated: "c_floor_insulated",
  roofBare: "c_roof_bare",
  roofInsulated: "c_roof_insulated",
  interiorDrywall: "c_iw_drywall",
  interiorPartition: "c_iw_partition",
  interiorBearing24: "c_iw_bearing_24",
  interiorBearing365: "c_iw_bearing_365",
} as const;

type PresetKey = keyof typeof PRESET_IDS;

const presetDefs: Record<
  PresetKey,
  { category: ConstructionKind; uValue: number; en: string; de: string }
> = {
  wallBrick: {
    category: "wall",
    uValue: 1.47,
    en: "Brick wall, uninsulated",
    de: "Ziegelwand, ungedämmt",
  },
  wall1970: { category: "wall", uValue: 0.74, en: "Wall, 1970s", de: "Wand, 1970er" },
  wallInsulated: { category: "wall", uValue: 0.19, en: "Wall, insulated", de: "Wand, gedämmt" },
  glazingSingle: { category: "window", uValue: 5.0, en: "Single glazing", de: "Einfachverglasung" },
  glazingDouble: {
    category: "window",
    uValue: 2.8,
    en: "Double glazing",
    de: "Zweifachverglasung",
  },
  glazingTriple: {
    category: "window",
    uValue: 0.8,
    en: "Triple glazing",
    de: "Dreifachverglasung",
  },
  doorOld: { category: "door", uValue: 3.0, en: "Door, old", de: "Tür, alt" },
  doorInsulated: { category: "door", uValue: 1.3, en: "Door, insulated", de: "Tür, gedämmt" },
  floorBare: {
    category: "floor",
    uValue: 1.69,
    en: "Floor slab, uninsulated",
    de: "Bodenplatte, ungedämmt",
  },
  floorInsulated: {
    category: "floor",
    uValue: 0.26,
    en: "Floor slab, insulated",
    de: "Bodenplatte, gedämmt",
  },
  roofBare: { category: "roof", uValue: 1.47, en: "Roof, uninsulated", de: "Dach, ungedämmt" },
  roofInsulated: { category: "roof", uValue: 0.16, en: "Roof, insulated", de: "Dach, gedämmt" },
  interiorDrywall: {
    category: "interiorWall",
    uValue: 0.4,
    en: "Drywall, 10 cm",
    de: "Trockenbauwand, 10 cm",
  },
  interiorPartition: {
    category: "interiorWall",
    uValue: 2.49,
    en: "Partition wall, 11.5 cm",
    de: "Trennwand, 11,5 cm",
  },
  interiorBearing24: {
    category: "interiorWall",
    uValue: 1.8,
    en: "Load-bearing wall, 24 cm",
    de: "Tragende Wand, 24 cm",
  },
  interiorBearing365: {
    category: "interiorWall",
    uValue: 1.41,
    en: "Load-bearing wall, 36.5 cm",
    de: "Tragende Wand, 36,5 cm",
  },
};

/**
 * Material conductivities λ in W/(m·K), design values after DIN 4108-4 table 1
 * and the common manufacturer values: gypsum plaster 0.70, lime cement render
 * 1.00, solid brick (1900) 0.81, lightweight brick 0.58, aerated concrete 0.21,
 * reinforced concrete 2.30, EPS and mineral wool 0.035, XPS 0.034, timber 0.13,
 * plasterboard 0.25, bitumen membrane 0.17, sand and gravel 2.0.
 */
const materials = {
  plasterIn: { en: "Gypsum plaster", de: "Gipsputz", lambda: 0.7 },
  render: { en: "Lime cement render", de: "Kalkzementputz", lambda: 1.0 },
  brickSolid: { en: "Solid brick", de: "Vollziegel", lambda: 0.81 },
  brickLight: { en: "Lightweight brick", de: "Leichthochlochziegel", lambda: 0.58 },
  aerated: { en: "Aerated concrete", de: "Porenbeton", lambda: 0.21 },
  concrete: { en: "Reinforced concrete", de: "Stahlbeton", lambda: 2.3 },
  eps: { en: "EPS insulation", de: "EPS-Dämmung", lambda: 0.035 },
  wool: { en: "Mineral wool", de: "Mineralwolle", lambda: 0.035 },
  xps: { en: "XPS insulation", de: "XPS-Dämmung", lambda: 0.034 },
  timber: { en: "Timber boards", de: "Holzschalung", lambda: 0.13 },
  plasterboard: { en: "Plasterboard", de: "Gipskartonplatte", lambda: 0.25 },
  bitumen: { en: "Bitumen membrane", de: "Bitumenbahn", lambda: 0.17 },
  screed: { en: "Cement screed", de: "Zementestrich", lambda: 1.4 },
  woodwool: { en: "Wood wool board", de: "Holzwolle-Leichtbauplatte", lambda: 0.09 },
  cinder: { en: "Cinder fill", de: "Schlackeschüttung", lambda: 0.25 },
} as const;

type MaterialKey = keyof typeof materials;

/**
 * Layer stacks from outside to inside, thickness in millimetres. Interior walls are the raw
 * sizes German plans dimension (octametric brick: 11.5, 24, 36.5 cm), without plaster.
 */
const presetLayers: Partial<Record<PresetKey, [MaterialKey, number][]>> = {
  wallBrick: [
    ["render", 20],
    ["brickSolid", 380],
    ["plasterIn", 15],
  ],
  wall1970: [
    ["render", 20],
    ["aerated", 240],
    ["plasterIn", 15],
  ],
  wallInsulated: [
    ["render", 10],
    ["eps", 160],
    ["brickLight", 240],
    ["plasterIn", 15],
  ],
  roofBare: [
    ["bitumen", 5],
    ["timber", 24],
    ["woodwool", 25],
    ["plasterboard", 12.5],
  ],
  roofInsulated: [
    ["bitumen", 5],
    ["timber", 24],
    ["wool", 200],
    ["plasterboard", 12.5],
  ],
  floorBare: [
    ["concrete", 150],
    ["cinder", 80],
    ["screed", 50],
  ],
  floorInsulated: [
    ["xps", 120],
    ["concrete", 150],
    ["screed", 50],
  ],
  interiorDrywall: [
    ["plasterboard", 12.5],
    ["wool", 75],
    ["plasterboard", 12.5],
  ],
  interiorPartition: [["brickSolid", 115]],
  interiorBearing24: [["brickSolid", 240]],
  interiorBearing365: [["brickSolid", 365]],
};

export function layersFor(key: PresetKey, language: "en" | "de"): Layer[] | undefined {
  const stack = presetLayers[key];
  if (!stack) return undefined;
  return stack.map(([m, mm], i) => ({
    id: `${PRESET_IDS[key]}_l${i + 1}`,
    name: materials[m][language],
    thickness: mm / 1000,
    conductivity: materials[m].lambda,
  }));
}

export function defaultConstructions(language: "en" | "de"): Construction[] {
  return (Object.keys(presetDefs) as PresetKey[]).map((key) => {
    const def = presetDefs[key];
    const layers = layersFor(key, language);
    const c: Construction = {
      id: PRESET_IDS[key],
      name: def[language],
      category: def.category,
      uValue: def.uValue,
    };
    if (layers) {
      c.layers = layers;
      c.uValue = uValueFromLayers(layers, def.category);
    }
    return c;
  });
}

/** Default assignment for a building that has no energy data yet: the uninsulated stock. */
export const DEFAULT_ASSIGNMENT = {
  wallConstructionId: PRESET_IDS.wallBrick,
  floorConstructionId: PRESET_IDS.floorBare,
  roofConstructionId: PRESET_IDS.roofBare,
  windowConstructionId: PRESET_IDS.glazingDouble,
  doorConstructionId: PRESET_IDS.doorOld,
} as const;

/** The construction with the lowest U-value in the same category: the "after renovation" choice. */
export function bestInCategory(
  all: readonly Construction[],
  category: ConstructionKind,
): Construction | undefined {
  return all
    .filter((c) => c.category === category)
    .reduce<Construction | undefined>(
      (best, c) => (best === undefined || c.uValue < best.uValue ? c : best),
      undefined,
    );
}

export function findConstruction(
  all: readonly Construction[],
  id: string,
): Construction | undefined {
  return all.find((c) => c.id === id);
}

// Interior wall types -----------------------------------------------------------------------

/** The type an interior wall has until one is chosen: a brick partition, 11.5 cm. */
export const DEFAULT_INTERIOR_WALL: Id = PRESET_IDS.interiorPartition;

/** The interior wall presets, for buildings saved before interior walls had types. */
const INTERIOR_PRESETS = defaultConstructions("en").filter((c) => c.category === "interiorWall");

/** Adds the interior wall presets a building's constructions lack, in `language`. */
export function withInteriorWallTypes(
  constructions: readonly Construction[],
  language: "en" | "de",
): Construction[] {
  const missing = defaultConstructions(language).filter(
    (c) => c.category === "interiorWall" && !constructions.some((x) => x.id === c.id),
  );
  return [...constructions, ...missing];
}

/** The type of an interior wall: its own, or the default partition when it has none. */
export function interiorWallType(
  constructions: readonly Construction[],
  wall: { constructionId?: Id },
): Construction {
  const find = (id: Id) =>
    constructions.find((c) => c.id === id && c.category === "interiorWall") ??
    INTERIOR_PRESETS.find((c) => c.id === id);
  const fallback = find(DEFAULT_INTERIOR_WALL);
  const own = wall.constructionId === undefined ? undefined : find(wall.constructionId);
  const type = own ?? fallback;
  if (!type) throw new Error("The default interior wall preset is missing");
  return type;
}

/** Below this a layer stack says nothing about the wall's size: the default partition is used. */
const MIN_THICKNESS = 0.05;

/** How thick each interior wall is, from its type's layers. */
export function interiorWallThickness(constructions: readonly Construction[]): ThicknessOf {
  const standard = totalThickness(interiorWallType([], {}).layers ?? []);
  return (wall) => {
    const t = totalThickness(interiorWallType(constructions, wall).layers ?? []);
    return t >= MIN_THICKNESS ? t : standard;
  };
}

/** The interior wall type closest in thickness to `metres`: a thickness read off a plan. */
export function nearestInteriorWallType(
  constructions: readonly Construction[],
  metres: number,
): Construction {
  const thicknessOf = interiorWallThickness(constructions);
  const types = withInteriorWallTypes(constructions, "en").filter(
    (c) => c.category === "interiorWall",
  );
  return types.reduce((best, c) =>
    Math.abs(thicknessOf({ constructionId: c.id }) - metres) <
    Math.abs(thicknessOf({ constructionId: best.id }) - metres)
      ? c
      : best,
  );
}
