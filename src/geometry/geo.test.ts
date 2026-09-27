import { describe, expect, it } from "vitest";
import {
  epsgForZone,
  fromUtm,
  latLonToPlan,
  northInPlan,
  bearingInPlan,
  planBearing,
  compassPoint,
  toEastNorth,
  planToLatLon,
  planToUtm,
  toUtm,
  utmZone,
} from "./geo";
import { fromGeoJson, toGeoJson } from "./geojson";
import { rect } from "./fixtures";
import { area, isCounterClockwise } from "./polygon";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";

describe("UTM zones", () => {
  it("numbers zones and central meridians, Berlin is 33 / EPSG 25833", () => {
    expect(utmZone(13.4)).toBe(33);
    expect(epsgForZone(33)).toBe(25833);
    expect(utmZone(11.99)).toBe(32);
    expect(utmZone(12.0)).toBe(33);
    expect(utmZone(-3)).toBe(30);
    expect(utmZone(179.9)).toBe(60);
  });
});

describe("toUtm and fromUtm", () => {
  it("a point on the central meridian at the equator is 500000 E, 0 N", () => {
    const u = toUtm({ lat: 0, lon: 15 });
    expect(u.zone).toBe(33);
    expect(u.easting).toBeCloseTo(500000, 6);
    expect(u.northing).toBeCloseTo(0, 6);
  });

  it("matches pyproj (EPSG:4258 to EPSG:25833) to 1 mm at Berlin reference points", () => {
    // Reference values computed with pyproj 3 / PROJ, EPSG:25833, on 2026-09-05.
    const cases: [number, number, number, number][] = [
      [52.516275, 13.377704, 389918.0415, 5819699.1323], // Brandenburger Tor
      [52.5, 15, 500000.0, 5816652.0063], // on the central meridian
      [52.5, 12, 296374.8298, 5820882.9785], // western zone edge
    ];
    for (const [lat, lon, e, nn] of cases) {
      const u = toUtm({ lat, lon }, 33);
      expect(Math.abs(u.easting - e)).toBeLessThan(0.001);
      expect(Math.abs(u.northing - nn)).toBeLessThan(0.001);
    }
    // Eiffel Tower in zone 31, EPSG:32631: pyproj gives 448251.8179 E, 5411935.1232 N.
    const eiffel = toUtm({ lat: 48.858222, lon: 2.2945 });
    expect(eiffel.zone).toBe(31);
    expect(Math.abs(eiffel.easting - 448251.8179)).toBeLessThan(0.001);
    expect(Math.abs(eiffel.northing - 5411935.1232)).toBeLessThan(0.001);
  });

  it("round trips with an error under 0.1 mm across Germany", () => {
    for (const p of [
      { lat: 52.516275, lon: 13.377704 },
      { lat: 48.1351, lon: 11.582 },
      { lat: 53.5511, lon: 9.9937 },
      { lat: 47.5, lon: 7.6 },
      { lat: 54.8, lon: 14.9 },
    ]) {
      const u = toUtm(p);
      const back = fromUtm(u);
      const again = toUtm(back);
      expect(Math.hypot(again.easting - u.easting, again.northing - u.northing)).toBeLessThan(
        0.001,
      );
      expect(Math.abs(back.lat - p.lat) * 111320).toBeLessThan(0.0001);
      expect(Math.abs(back.lon - p.lon) * 111320).toBeLessThan(0.0001);
    }
  });

  it("uses the southern false northing", () => {
    const u = toUtm({ lat: -33.8688, lon: 151.2093 });
    expect(u.north).toBe(false);
    expect(u.northing).toBeGreaterThan(6000000);
    const back = fromUtm(u);
    expect(back.lat).toBeCloseTo(-33.8688, 6);
  });
});

describe("plan placement", () => {
  const origin = { lat: 52.516275, lon: 13.377704, rotation: 0 };

  it("moves east and north with x and y when not rotated", () => {
    const base = planToUtm({ x: 0, y: 0 }, origin);
    const e = planToUtm({ x: 10, y: 0 }, origin);
    const n = planToUtm({ x: 0, y: 8 }, origin);
    expect(e.easting - base.easting).toBeCloseTo(10, 6);
    expect(n.northing - base.northing).toBeCloseTo(8, 6);
  });

  it("rotation turns the plan clockwise and round trips", () => {
    const turned = { ...origin, rotation: 90 };
    const p = planToUtm({ x: 0, y: 8 }, turned);
    const base = planToUtm({ x: 0, y: 0 }, turned);
    // +y now points east
    expect(p.easting - base.easting).toBeCloseTo(8, 6);
    expect(p.northing - base.northing).toBeCloseTo(0, 6);
    const ll = planToLatLon({ x: 3.5, y: -2 }, turned);
    const back = latLonToPlan(ll, turned);
    expect(back.x).toBeCloseTo(3.5, 4);
    expect(back.y).toBeCloseTo(-2, 4);
    expect(northInPlan(turned).x).toBeCloseTo(-1);
    expect(northInPlan(undefined)).toEqual({ x: -0, y: 1 });
  });
});

describe("GeoJSON", () => {
  it("exports one closed counter-clockwise polygon per storey plus a building feature in lon lat order", () => {
    resetIds();
    const b = { ...exampleHouse("en"), origin: { lat: 52.516275, lon: 13.377704, rotation: 30 } };
    const gj = toGeoJson(b);
    expect(gj.type).toBe("FeatureCollection");
    expect(gj.features).toHaveLength(3);
    const first = gj.features[0]!;
    const ringCoords = first.geometry.coordinates[0]!;
    expect(ringCoords).toHaveLength(5);
    expect(ringCoords[0]).toEqual(ringCoords[4]);
    for (const [lon, lat] of ringCoords as [number, number][]) {
      expect(lon).toBeGreaterThan(13.37);
      expect(lon).toBeLessThan(13.39);
      expect(lat).toBeGreaterThan(52.51);
      expect(lat).toBeLessThan(52.52);
    }
    const asPlan = ringCoords.slice(0, 4).map(([lon, lat]) => ({ x: lon ?? 0, y: lat ?? 0 }));
    expect(isCounterClockwise(asPlan)).toBe(true);
    const building = gj.features[2]!;
    expect(building.properties.epsg).toBe(25833);
    expect(building.properties.energyClass).toBeDefined();
  });

  it("imports a polygon, snaps it to the grid and keeps its size", () => {
    const origin = { lat: 52.516275, lon: 13.377704, rotation: 0 };
    const coords = rect.map((p) => {
      const ll = planToLatLon(p, origin);
      return [ll.lon, ll.lat];
    });
    coords.push(coords[0]!);
    const result = fromGeoJson(
      JSON.stringify({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: {},
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.footprint).toHaveLength(4);
    expect(area(result.footprint)).toBeCloseTo(80, 6);
    expect(isCounterClockwise(result.footprint)).toBe(true);
    expect(result.origin.lat).toBeCloseTo(52.5163, 3);
  });

  it("rejects bad input", () => {
    expect(fromGeoJson("{")).toEqual({ ok: false, error: "invalidJson" });
    expect(fromGeoJson('{"type":"Point","coordinates":[1,2]}')).toEqual({
      ok: false,
      error: "noPolygon",
    });
    const bow = [
      [13.0, 52.0],
      [13.001, 52.001],
      [13.001, 52.0],
      [13.0, 52.001],
      [13.0, 52.0],
    ];
    expect(fromGeoJson(JSON.stringify({ type: "Polygon", coordinates: [bow] }))).toEqual({
      ok: false,
      error: "footprintInvalid",
    });
  });
});

describe("bearings in the plan", () => {
  const close = (a: number, b: number) => {
    expect(a).toBeCloseTo(b, 9);
  };

  it("bearing 0 is north and bearing 90 is east, for any plan rotation", () => {
    for (const rotation of [0, 30, -75, 180]) {
      const origin = { lat: 52.5, lon: 13.4, rotation };
      const north = northInPlan(origin);
      const n = bearingInPlan(origin, 0);
      close(n.x, north.x);
      close(n.y, north.y);
      // East is north turned a quarter clockwise, which on a plan with y up is (y, -x).
      const e = bearingInPlan(origin, 90);
      close(e.x, north.y);
      close(e.y, -north.x);
    }
  });

  it("matches the real east on the ground, not only the formula", () => {
    const origin = { lat: 52.5, lon: 13.4, rotation: 30 };
    const east = latLonToPlan({ lat: 52.5, lon: 13.4001 }, origin);
    const length = Math.hypot(east.x, east.y);
    const e = bearingInPlan(origin, 90);
    expect(Math.abs(e.x - east.x / length)).toBeLessThan(0.03);
    expect(Math.abs(e.y - east.y / length)).toBeLessThan(0.03);
  });

  it("planBearing is the inverse of bearingInPlan", () => {
    const origin = { lat: 52.5, lon: 13.4, rotation: 20 };
    for (const bearing of [0, 45, 90, 135, 225, 359]) {
      close(planBearing(origin, bearingInPlan(origin, bearing)), bearing);
    }
    close(planBearing(undefined, { x: 0, y: 1 }), 0);
    close(planBearing(undefined, { x: 1, y: 0 }), 90);
  });

  it("names the nearest compass point", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(200)).toBe("S");
    expect(compassPoint(-30)).toBe("NW");
    expect(compassPoint(359)).toBe("N");
  });
});

describe("toEastNorth", () => {
  it("is the identity for an unrotated plan", () => {
    const p = toEastNorth(undefined, { x: 3, y: 4 });
    expect(p.east).toBeCloseTo(3, 9);
    expect(p.north).toBeCloseTo(4, 9);
  });

  it("undoes the plan rotation, so a point due north stays due north", () => {
    const origin = { lat: 52.5, lon: 13.4, rotation: 30 };
    const n = northInPlan(origin);
    const p = toEastNorth(origin, { x: n.x * 10, y: n.y * 10 });
    expect(p.east).toBeCloseTo(0, 9);
    expect(p.north).toBeCloseTo(10, 9);
  });
});
