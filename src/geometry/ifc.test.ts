import { describe, expect, it } from "vitest";
import { toIfc } from "./ifc";
import { ifcGuid, real, str } from "./step";
import { PRESET_IDS, defaultConstructions } from "./constructions";
import { exampleBlock, exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import type { Building } from "./types";

interface Entity {
  id: number;
  type: string;
  args: string;
}

/** Small STEP tokenizer: enough to check structure, references and counts. */
function parse(text: string): { header: string[]; entities: Map<number, Entity> } {
  const lines = text.split("\n");
  expect(lines[0]).toBe("ISO-10303-21;");
  expect(lines.at(-2)).toBe("END-ISO-10303-21;");
  const header = lines.slice(lines.indexOf("HEADER;") + 1, lines.indexOf("ENDSEC;"));
  const dataStart = lines.indexOf("DATA;");
  const entities = new Map<number, Entity>();
  for (const line of lines.slice(dataStart + 1)) {
    if (line === "ENDSEC;" || line === "") break;
    const m = /^#(\d+)=([A-Z0-9]+)\((.*)\);$/.exec(line);
    if (!m) throw new Error(`Bad entity line: ${line}`);
    const id = Number(m[1]);
    expect(entities.has(id)).toBe(false);
    entities.set(id, { id, type: m[2] ?? "", args: m[3] ?? "" });
  }
  return { header, entities };
}

const count = (entities: Map<number, Entity>, type: string) =>
  [...entities.values()].filter((e) => e.type === type).length;

function house(): Building {
  resetIds();
  return exampleHouse("de");
}

describe("STEP primitives", () => {
  it("formats reals with a decimal point and no exponent", () => {
    expect(real(3)).toBe("3.");
    expect(real(0.25)).toBe("0.25");
    expect(real(1e-5)).toBe("0.00001");
    expect(real(-2.5)).toBe("-2.5");
    expect(real(10 / 3)).toBe("3.333333");
  });

  it("escapes strings and encodes umlauts as X2", () => {
    expect(str("it's")).toBe("'it''s'");
    expect(str("a\\b")).toBe("'a\\\\b'");
    expect(str("Küche")).toBe("'K\\X2\\00FC\\X0\\che'");
    expect(str("Büro Tür")).toBe("'B\\X2\\00FC\\X0\\ro T\\X2\\00FC\\X0\\r'");
  });

  it("makes stable 22 character GlobalIds", () => {
    const a = ifcGuid("storey_1");
    expect(a).toHaveLength(22);
    expect(a).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(ifcGuid("storey_1")).toBe(a);
    expect(ifcGuid("storey_2")).not.toBe(a);
  });
});

describe("toIfc", () => {
  it("exports of two overlapping openings only the one the energy balance counts", () => {
    const b = house();
    const storey = b.storeys[0]!;
    const first = storey.openings[0]!;
    const before = parse(toIfc(b)).entities;
    storey.openings.push({ ...first, id: "late", offset: first.offset + 0.1 });
    const after = parse(toIfc(b)).entities;
    expect(count(after, "IFCOPENINGELEMENT")).toBe(count(before, "IFCOPENINGELEMENT"));
  });

  it("writes a valid header with the IFC4 schema", () => {
    const { header } = parse(
      toIfc(house(), { timestamp: "2026-09-05T12:00:00", fileName: "haus.ifc" }),
    );
    expect(header.some((l) => l.startsWith("FILE_SCHEMA(('IFC4'))"))).toBe(true);
    expect(
      header.some((l) => l.includes("'haus.ifc'") && l.includes("'2026-09-05T12:00:00'")),
    ).toBe(true);
  });

  it("every referenced id exists and every entity is referenced or is a root or relationship", () => {
    const { entities } = parse(toIfc(house()));
    const referenced = new Set<number>();
    for (const e of entities.values()) {
      for (const m of e.args.matchAll(/#(\d+)/g)) {
        const id = Number(m[1]);
        expect(entities.has(id)).toBe(true);
        referenced.add(id);
      }
    }
    for (const e of entities.values()) {
      const isRoot = e.type === "IFCPROJECT";
      // Relationships and material property definitions point at their targets and are not referenced themselves.
      const isRel = e.type.startsWith("IFCREL") || e.type === "IFCMATERIALPROPERTIES";
      if (!isRoot && !isRel) expect(referenced.has(e.id)).toBe(true);
    }
  });

  it("entity counts match the model", () => {
    const b = house();
    const { entities } = parse(toIfc(b));
    const storeys = b.storeys.length;
    const exteriorWalls = b.footprint.length * storeys;
    const interior = b.storeys.reduce((s, st) => s + st.interiorWalls.length, 0);
    const openings = b.storeys.reduce((s, st) => s + st.openings.length, 0);
    const windows = b.storeys.reduce(
      (s, st) => s + st.openings.filter((o) => o.kind === "window").length,
      0,
    );
    const doors = openings - windows;
    const rooms = b.storeys.reduce((s, st) => s + st.rooms.length, 0);
    expect(count(entities, "IFCPROJECT")).toBe(1);
    expect(count(entities, "IFCSITE")).toBe(1);
    expect(count(entities, "IFCBUILDING")).toBe(1);
    expect(count(entities, "IFCBUILDINGSTOREY")).toBe(storeys);
    expect(count(entities, "IFCWALL")).toBe(exteriorWalls + interior);
    expect(count(entities, "IFCOPENINGELEMENT")).toBe(openings);
    expect(count(entities, "IFCWINDOW")).toBe(windows);
    expect(count(entities, "IFCDOOR")).toBe(doors);
    expect(count(entities, "IFCRELVOIDSELEMENT")).toBe(openings);
    expect(count(entities, "IFCRELFILLSELEMENT")).toBe(openings);
    expect(count(entities, "IFCSPACE")).toBe(rooms);
    expect(count(entities, "IFCZONE")).toBe(b.zones.length);
    expect(count(entities, "IFCSLAB")).toBe(storeys + 1);
    expect(count(entities, "IFCRELCONTAINEDINSPATIALSTRUCTURE")).toBe(storeys);
  });

  it("every wall, window, door, space and slab has exactly one representation", () => {
    const { entities } = parse(toIfc(house()));
    for (const e of entities.values()) {
      if (
        !["IFCWALL", "IFCWINDOW", "IFCDOOR", "IFCSPACE", "IFCSLAB", "IFCOPENINGELEMENT"].includes(
          e.type,
        )
      )
        continue;
      const args = e.args.split(",");
      const shapeRef = args[6];
      expect(shapeRef).toMatch(/^#\d+$/);
      const pds = entities.get(Number(shapeRef?.slice(1)));
      expect(pds?.type).toBe("IFCPRODUCTDEFINITIONSHAPE");
      expect((pds?.args.match(/#\d+/g) ?? []).length).toBe(1);
    }
  });

  it("storeys carry their elevation and the spatial tree aggregates top down", () => {
    const b = house();
    const { entities } = parse(toIfc(b));
    const storeys = [...entities.values()].filter((e) => e.type === "IFCBUILDINGSTOREY");
    const elevations = storeys.map((s) => Number(s.args.split(",").at(-1)));
    expect(elevations).toEqual([0, 3]);
    const aggregates = [...entities.values()].filter((e) => e.type === "IFCRELAGGREGATES");
    const project = [...entities.values()].find((e) => e.type === "IFCPROJECT")!;
    const site = [...entities.values()].find((e) => e.type === "IFCSITE")!;
    const building = [...entities.values()].find((e) => e.type === "IFCBUILDING")!;
    const relating = (rel: Entity) => Number(rel.args.split(",")[4]?.slice(1));
    expect(
      aggregates.some((r) => relating(r) === project.id && r.args.includes(`#${site.id}`)),
    ).toBe(true);
    expect(
      aggregates.some((r) => relating(r) === site.id && r.args.includes(`#${building.id}`)),
    ).toBe(true);
    expect(
      aggregates.some(
        (r) => relating(r) === building.id && storeys.every((s) => r.args.includes(`#${s.id}`)),
      ),
    ).toBe(true);
  });

  it("writes U-values into property sets and umlauts into names", () => {
    const text = toIfc(house());
    const wallU = defaultConstructions("de").find((c) => c.id === PRESET_IDS.wallBrick)!.uValue;
    expect(text).toContain(
      `IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(${real(wallU)}),$)`,
    );
    expect(text).toContain("IFCTHERMALTRANSMITTANCEMEASURE(2.8)");
    expect(text).toContain("'K\\X2\\00FC\\X0\\che'");
    expect(text).not.toMatch(/[^\x20-\x7e\n]/);
  });

  it("skips invalid openings and handles the L-shaped block", () => {
    resetIds();
    const block = exampleBlock("en");
    block.storeys[0]!.openings[0]!.offset = 99;
    const { entities } = parse(toIfc(block));
    const openings = block.storeys.reduce((s, st) => s + st.openings.length, 0);
    expect(count(entities, "IFCOPENINGELEMENT")).toBe(openings - 1);
    expect(count(entities, "IFCBUILDINGSTOREY")).toBe(3);
  });
});

describe("attribute typing", () => {
  it("writes declared-type attributes as plain values, not typed wrappers", () => {
    // LongName is declared IfcLabel, so a typed IFCLABEL('..') wrapper is a schema error
    // (found by IfcOpenShell's validator, see DECISIONS.md).
    const text = toIfc(house());
    // Property values are SELECT types and do need the wrapper; entity attributes do not.
    expect(text).not.toMatch(/IFCSPACE\([^\n]*IFCLABEL\(/);
    expect(text).toMatch(
      /IFCSPACE\('[^']+',\$,'K\\X2\\00FC\\X0\\che',\$,\$,#\d+,#\d+,'K\\X2\\00FC\\X0\\che',\.ELEMENT\.,\.INTERNAL\.,\$\)/,
    );
  });
});

describe("georeferencing", () => {
  it("writes IfcProjectedCRS and IfcMapConversion when an origin is set", () => {
    const b = { ...house(), origin: { lat: 52.516275, lon: 13.377704, rotation: 30 } };
    const text = toIfc(b);
    expect(text).toContain("IFCPROJECTEDCRS('EPSG:25833'");
    expect(text).toMatch(
      /IFCMAPCONVERSION\(#\d+,#\d+,389918\.04\d*,5819699\.13\d*,0\.,0\.866025,-0\.5,1\.\)/,
    );
    const { entities } = parse(text);
    expect(count(entities, "IFCMAPCONVERSION")).toBe(1);
    expect(toIfc(house())).not.toContain("IFCMAPCONVERSION");
  });
});

describe("material layers", () => {
  it("writes one shared layer set for the wall construction and associates every exterior wall", () => {
    const b = house();
    const { entities } = parse(toIfc(b));
    const wallLayers = b.constructions.find((c) => c.id === b.wallConstructionId)!.layers!.length;
    expect(count(entities, "IFCMATERIALLAYERSET")).toBe(1);
    expect(count(entities, "IFCMATERIALLAYER")).toBe(wallLayers);
    expect(count(entities, "IFCMATERIAL")).toBe(wallLayers);
    expect(count(entities, "IFCMATERIALPROPERTIES")).toBe(wallLayers);
    const exteriorWalls = b.footprint.length * b.storeys.length;
    expect(count(entities, "IFCMATERIALLAYERSETUSAGE")).toBe(exteriorWalls);
    expect(count(entities, "IFCRELASSOCIATESMATERIAL")).toBe(exteriorWalls);
    const layer = [...entities.values()].find((e) => e.type === "IFCMATERIALLAYER")!;
    expect(layer.args).toMatch(/^#\d+,0\.02,/); // render, 20 mm, outside first
  });
});

describe("roof", () => {
  it("a gable roof is an IfcRoof with one ROOF slab member per face and a Pset_RoofCommon", () => {
    const b = {
      ...house(),
      roof: { kind: "gable" as const, pitch: 40, overhang: 0.3, ridgeAxis: "x" as const },
    };
    const { entities } = parse(toIfc(b));
    expect(count(entities, "IFCROOF")).toBe(1);
    expect(count(entities, "IFCSHELLBASEDSURFACEMODEL")).toBe(2);
    expect(
      [...entities.values()].filter((e) => e.type === "IFCSLAB" && e.args.includes(".ROOF."))
        .length,
    ).toBe(1 + 2);
    expect(toIfc(house())).not.toContain("IFCROOF(");
  });
});

describe("heating", () => {
  it("radiators, pipes and heat pumps become IfcSpaceHeater, IfcPipeSegment and IfcUnitaryEquipment", () => {
    const b = house();
    b.storeys[0]!.radiators = [
      { id: "rad1", wallIndex: 2, offset: 0.5, width: 1, height: 0.6, power: 1200 },
    ];
    b.storeys[0]!.pipes = [
      {
        id: "pipe1",
        points: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 5, y: 4 },
        ],
      },
    ];
    b.heatPumps = [{ id: "hp1", position: { x: -2, y: 4 }, power: 9, kind: "air" }];
    const text = toIfc(b);
    const { entities } = parse(text);
    expect(count(entities, "IFCSPACEHEATER")).toBe(1);
    expect(count(entities, "IFCPIPESEGMENT")).toBe(2);
    expect(count(entities, "IFCUNITARYEQUIPMENT")).toBe(1);
    expect(text).toContain("IFCPOWERMEASURE(1200.)");
    expect(text).toContain("IFCPOWERMEASURE(9000.)");
  });
});
