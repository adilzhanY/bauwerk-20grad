import { describe, expect, it } from "vitest";
import { exampleAltbau, exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { areaList, areaListCsv, directionOf } from "./areaList";
import { computeEnergy } from "./energy";

describe("directionOf", () => {
  it("rounds a bearing to the nearest of eight directions", () => {
    expect(directionOf(0)).toBe("N");
    expect(directionOf(22)).toBe("N");
    expect(directionOf(23)).toBe("NE");
    expect(directionOf(180)).toBe("S");
    expect(directionOf(-90)).toBe("W");
    expect(directionOf(350)).toBe("N");
  });
});

describe("areaList", () => {
  it("adds up to exactly the areas and H_T of the energy balance", () => {
    for (const make of [exampleHouse, exampleAltbau]) {
      resetIds();
      const b = make("en");
      const e = computeEnergy(b);
      const rows = areaList(b, e);
      const elements = e.elements.filter((x) => x.category !== "bridge" && x.area > 0);
      const sum = (xs: { area: number }[]) => xs.reduce((s, x) => s + x.area, 0);
      expect(sum(rows.filter((r) => r.element !== "partyWall"))).toBeCloseTo(sum(elements), 6);
      expect(rows.reduce((s, r) => s + r.ht, 0)).toBeCloseTo(
        elements.reduce((s, x) => s + x.loss, 0),
        6,
      );
      // Windows of heated rooms only, as in the heat loss (windowArea counts every window).
      expect(sum(rows.filter((r) => r.element === "window"))).toBeCloseTo(
        sum(elements.filter((x) => x.category === "window")),
        6,
      );
    }
  });

  it("splits the facades of the house by direction, windows counted", () => {
    resetIds();
    const b = exampleHouse("en");
    const rows = areaList(b);
    const walls = rows.filter((r) => r.element === "wall");
    // A rectangle: one wall row per side, each at 90 degrees.
    expect(new Set(walls.map((r) => r.direction))).toEqual(new Set(["N", "E", "S", "W"]));
    expect(walls.every((r) => r.tilt === 90 && r.fx === 1)).toBe(true);
    const windows = rows.filter((r) => r.element === "window");
    const heatedWindows = computeEnergy(b).elements.filter((x) => x.category === "window").length;
    expect(windows.reduce((n, r) => n + r.count, 0)).toBe(heatedWindows);
    // The floor to the ground carries its correction factor below 1.
    expect(rows.find((r) => r.element === "floor")?.fx).toBeLessThan(1);
  });

  it("lists party walls with no heat loss", () => {
    resetIds();
    const b = { ...exampleHouse("en"), sharedEdges: [1] };
    const party = areaList(b).filter((r) => r.element === "partyWall");
    expect(party).toHaveLength(1);
    const height = b.storeys.reduce((s, x) => s + x.height, 0);
    expect(party[0]?.area).toBeCloseTo(8 * height);
    expect(party[0]?.ht).toBe(0);
  });
});

describe("areaListCsv", () => {
  it("writes German numbers with semicolons, English with commas", () => {
    const rows = [
      {
        element: "wall" as const,
        direction: "S" as const,
        tilt: 90,
        area: 24.5,
        uValue: 1.4,
        fx: 1,
        ht: 34.3,
        count: 0,
      },
      {
        element: "window" as const,
        direction: "S" as const,
        tilt: 90,
        area: 3.36,
        uValue: 2.8,
        fx: 1,
        ht: 9.408,
        count: 2,
      },
    ];
    const words = {
      header: ["Bauteil", "Richtung", "Neigung", "Fläche", "U", "Fx", "HT", "Anzahl"],
      element: (e: string) => (e === "wall" ? "Außenwand" : "Fenster"),
      direction: (d: string) => d,
    };
    expect(areaListCsv(rows, words, "de")).toBe(
      "Bauteil;Richtung;Neigung;Fläche;U;Fx;HT;Anzahl\r\n" +
        "Außenwand;S;90;24,50;1,40;1,00;34,30;\r\n" +
        "Fenster;S;90;3,36;2,80;1,00;9,41;2\r\n",
    );
    expect(areaListCsv(rows, words, "en").split("\r\n")[1]).toBe(
      "Außenwand,S,90,24.50,1.40,1.00,34.30,",
    );
  });
});
