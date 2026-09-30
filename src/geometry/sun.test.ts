import { describe, expect, it } from "vitest";
import { julianDay, solarGains, sunPath, sunPosition, sunriseSunset } from "./sun";

const BERLIN = { lat: 52.52, lon: 13.405 };
const utc = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

describe("sun position", () => {
  it("J2000 epoch is Julian day 2451545.0", () => {
    expect(julianDay(2000, 1, 1, 12)).toBeCloseTo(2451545, 6);
  });

  it("noon elevation on the solstices in Berlin follows 90 minus latitude plus or minus the declination", () => {
    // Solar noon in Berlin is about 11:06 UTC in June and 11:00 UTC in December.
    const june = sunPosition(utc(2026, 6, 21, 11, 6), BERLIN.lat, BERLIN.lon);
    expect(Math.abs(june.elevation - (90 - 52.52 + 23.44))).toBeLessThan(0.4);
    expect(Math.abs(june.azimuth - 180)).toBeLessThan(1.5);
    const dec = sunPosition(utc(2026, 12, 21, 11, 0), BERLIN.lat, BERLIN.lon);
    expect(Math.abs(dec.elevation - (90 - 52.52 - 23.44))).toBeLessThan(0.4);
  });

  it("morning sun is in the east, evening sun in the west, midnight below the horizon", () => {
    const morning = sunPosition(utc(2026, 6, 21, 5, 0), BERLIN.lat, BERLIN.lon);
    expect(morning.azimuth).toBeGreaterThan(50);
    expect(morning.azimuth).toBeLessThan(90);
    const evening = sunPosition(utc(2026, 6, 21, 17, 0), BERLIN.lat, BERLIN.lon);
    expect(evening.azimuth).toBeGreaterThan(260);
    expect(evening.azimuth).toBeLessThan(300);
    expect(sunPosition(utc(2026, 6, 21, 0, 0), BERLIN.lat, BERLIN.lon).elevation).toBeLessThan(0);
  });

  it("sunrise and sunset in Berlin within four minutes of the almanac (UTC)", () => {
    // 21 June 2026: 04:43 to 21:33 CEST; 21 December 2026: 08:15 to 15:54 CET.
    const june = sunriseSunset(utc(2026, 6, 21, 12), BERLIN.lat, BERLIN.lon)!;
    expect(Math.abs(june.sunrise - (2 * 60 + 43))).toBeLessThan(4);
    expect(Math.abs(june.sunset - (19 * 60 + 33))).toBeLessThan(4);
    const dec = sunriseSunset(utc(2026, 12, 21, 12), BERLIN.lat, BERLIN.lon)!;
    expect(Math.abs(dec.sunrise - (7 * 60 + 15))).toBeLessThan(4);
    expect(Math.abs(dec.sunset - (14 * 60 + 54))).toBeLessThan(4);
    expect(hhmm(june.sunrise)).toMatch(/^02:4\d$/);
    // Polar night: Longyearbyen in December.
    expect(sunriseSunset(utc(2026, 12, 21, 12), 78.2, 15.6)).toBeNull();
  });

  it("the sun path has more daylight samples in June than in December", () => {
    const june = sunPath(utc(2026, 6, 21, 12), BERLIN.lat, BERLIN.lon, 30);
    const dec = sunPath(utc(2026, 12, 21, 12), BERLIN.lat, BERLIN.lon, 30);
    expect(june.length).toBeGreaterThan(30);
    expect(dec.length).toBeLessThan(18);
    expect(dec.length).toBeGreaterThan(12);
  });
});

describe("solar gains", () => {
  it("a south window gains more than a north window and gains scale with area times g", () => {
    // 1.68 m² of double thermal glazing, g 0.6.
    const south = solarGains({ N: 0, E: 0, S: 1.68 * 0.6, W: 0 });
    const north = solarGains({ N: 1.68 * 0.6, E: 0, S: 0, W: 0 });
    expect(south).toBeGreaterThan(north * 2);
    expect(solarGains({ N: 0, E: 0, S: 3.36 * 0.6, W: 0 })).toBeCloseTo(south * 2);
    // F_W 0.9, F_F 0.7, F_S 0.9, I 270, utilisation 0.95.
    expect(south).toBeCloseTo(1.68 * 0.6 * 0.9 * 0.7 * 0.9 * 270 * 0.95);
  });
});
