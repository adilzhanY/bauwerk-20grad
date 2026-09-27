/**
 * The IFC export read back by IfcOpenShell, an independent IFC implementation: schema valid,
 * every element's geometry builds, windows and doors cut their walls, and the counts per
 * storey match the building. Needs `uv` (it fetches IfcOpenShell into a throwaway
 * environment), so it runs on request: `npm run check:ifc`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { example } from "@/lib/examples";
import type { ExampleId } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { edges } from "./polygon";
import { distance } from "./polygon";
import { openingsOn, validateOpening } from "./openings";
import { toIfc } from "./ifc";
import type { Building, Opening, Storey } from "./types";

/** The openings the export writes: the valid ones, per wall, as the export checks them. */
function exported(building: Building, storey: Storey): Opening[] {
  const exterior = edges(building.footprint).flatMap((edge, index) => {
    const onWall = openingsOn(storey.openings, index);
    return onWall.filter(
      (o) =>
        validateOpening(o, {
          wallLength: edge.length,
          storeyHeight: storey.height,
          siblings: onWall,
        }).length === 0,
    );
  });
  const interior = storey.interiorWalls.flatMap((segment, index) => {
    const onWall = openingsOn(storey.openings, index, true);
    return onWall.filter(
      (o) =>
        validateOpening(o, {
          wallLength: distance(segment.a, segment.b),
          storeyHeight: storey.height,
          siblings: onWall,
        }).length === 0,
    );
  });
  return [...exterior, ...interior];
}

function expectation(building: Building) {
  return {
    storeys: building.storeys.map((storey) => {
      const openings = exported(building, storey);
      return {
        name: storey.name,
        walls: building.footprint.length + storey.interiorWalls.length,
        windows: openings.filter((o) => o.kind === "window").length,
        doors: openings.filter((o) => o.kind === "door").length,
        spaces: storey.rooms.length,
      };
    }),
  };
}

describe.runIf(process.env.IFC_CHECK)("IFC export read by IfcOpenShell", () => {
  const ids: ExampleId[] = ["house", "block", "altbau", "tower"];
  it.each(ids)(
    "%s",
    (id) => {
      resetIds();
      const building = example(id, "en");
      const dir = mkdtempSync(join(tmpdir(), "bauwerk-ifc-"));
      const ifc = join(dir, `${id}.ifc`);
      const expected = join(dir, `${id}.json`);
      writeFileSync(ifc, toIfc(building, { timestamp: "2026-09-26T00:00:00Z" }));
      writeFileSync(expected, JSON.stringify(expectation(building)));
      let output: string;
      let failed = false;
      try {
        output = execFileSync(
          "uv",
          [
            "run",
            "--quiet",
            "--with",
            "ifcopenshell",
            "--with",
            "pytest",
            "python",
            "scripts/validate-ifc.py",
            ifc,
            "--expect",
            expected,
          ],
          { encoding: "utf8" },
        );
      } catch (error) {
        failed = true;
        output = String((error as { stdout?: string }).stdout ?? error);
      }
      expect(output, output).toMatch(/0 problems/);
      expect(failed).toBe(false);
    },
    300_000,
  );
});
