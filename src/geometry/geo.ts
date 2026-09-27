import type { GeoOrigin, Vec2 } from "./types";
export type { GeoOrigin };

/**
 * WGS84 / ETRS89 to UTM and back, using the Krüger series as given by Karney
 * (2011), accurate to well under a millimetre within a zone. ETRS89 uses the GRS80
 * ellipsoid, which differs from WGS84 in the flattening only in the 10th decimal;
 * for building placement they are the same datum in Germany.
 *
 * Zone numbering: zone = floor((lon + 180) / 6) + 1, central meridian
 * = zone * 6 - 183. Berlin (13.4 E) is zone 33, EPSG:25833 (ETRS89 / UTM 33N).
 * The Norway and Svalbard exceptions are not implemented; Germany has none.
 */

const a = 6378137;
const f = 1 / 298.257222101; // GRS80
const k0 = 0.9996;
const E0 = 500000;
const n = f / (2 - f);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + (n4 * n2) / 256);
// Fourth-order Krüger coefficients (Karney 2011). Third order alone leaves a
// 0.7 mm bias in the inverse at German latitudes; fourth order is below 0.1 mm.
const alpha = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
  (61 * n3) / 240 - (103 * n4) / 140,
  (49561 * n4) / 161280,
];
const beta = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440,
  (17 * n3) / 480 - (37 * n4) / 840,
  (4397 * n4) / 161280,
];
const delta = [
  2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45,
  (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45,
  (56 * n3) / 15 - (136 * n4) / 35,
  (4279 * n4) / 630,
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Utm {
  zone: number;
  /** True for the northern hemisphere. */
  north: boolean;
  easting: number;
  northing: number;
}

export function utmZone(lon: number): number {
  const normalised = ((((lon + 180) % 360) + 360) % 360) - 180;
  return Math.min(60, Math.floor((normalised + 180) / 6) + 1);
}

export const centralMeridian = (zone: number): number => zone * 6 - 183;

/** EPSG code for ETRS89 / UTM zone N (25828 to 25838 cover Europe). */
export const epsgForZone = (zone: number): number => 25800 + zone;

export function toUtm(p: LatLon, zone = utmZone(p.lon)): Utm {
  const phi = rad(p.lat);
  const lambda = rad(p.lon - centralMeridian(zone));
  const sinPhi = Math.sin(phi);
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(sinPhi) - c * Math.atanh(c * sinPhi));
  const xi = Math.atan2(t, Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let e = eta;
  let nn = xi;
  for (let j = 1; j <= 4; j++) {
    const al = alpha[j - 1] ?? 0;
    e += al * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    nn += al * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  const north = p.lat >= 0;
  return {
    zone,
    north,
    easting: E0 + k0 * A * e,
    northing: (north ? 0 : 10000000) + k0 * A * nn,
  };
}

export function fromUtm(u: Utm): LatLon {
  const xi = (u.northing - (u.north ? 0 : 10000000)) / (k0 * A);
  const eta = (u.easting - E0) / (k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j++) {
    const b = beta[j - 1] ?? 0;
    xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += (delta[j - 1] ?? 0) * Math.sin(2 * j * chi);
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return { lat: deg(phi), lon: centralMeridian(u.zone) + deg(lambda) };
}

/** Plan point to UTM in the origin's zone. Local +y rotated by `rotation` points that far east of north. */
export function planToUtm(p: Vec2, origin: GeoOrigin): Utm {
  const base = toUtm(origin);
  const r = rad(origin.rotation);
  const east = p.x * Math.cos(r) + p.y * Math.sin(r);
  const north = -p.x * Math.sin(r) + p.y * Math.cos(r);
  return { ...base, easting: base.easting + east, northing: base.northing + north };
}

export function utmToPlan(u: Utm, origin: GeoOrigin): Vec2 {
  const base = toUtm(origin, u.zone);
  const east = u.easting - base.easting;
  const north = u.northing - base.northing;
  const r = rad(origin.rotation);
  return {
    x: east * Math.cos(r) - north * Math.sin(r),
    y: east * Math.sin(r) + north * Math.cos(r),
  };
}

export const planToLatLon = (p: Vec2, origin: GeoOrigin): LatLon => fromUtm(planToUtm(p, origin));

export function latLonToPlan(p: LatLon, origin: GeoOrigin): Vec2 {
  const zone = utmZone(origin.lon);
  return utmToPlan(toUtm(p, zone), origin);
}

/** Unit vector in plan coordinates that points to compass north. */
export function northInPlan(origin: GeoOrigin | undefined): Vec2 {
  const r = rad(origin?.rotation ?? 0);
  return { x: -Math.sin(r), y: Math.cos(r) };
}

/** Unit vector in plan coordinates for a compass bearing, degrees clockwise from north. */
export function bearingInPlan(origin: GeoOrigin | undefined, bearing: number): Vec2 {
  const r = rad((origin?.rotation ?? 0) - bearing);
  return { x: -Math.sin(r), y: Math.cos(r) };
}

/** Compass bearing of a plan direction, degrees clockwise from north in [0, 360). */
export function planBearing(origin: GeoOrigin | undefined, direction: Vec2): number {
  const planAngle = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
  const bearing = 90 + (origin?.rotation ?? 0) - planAngle;
  return ((bearing % 360) + 360) % 360;
}

/**
 * A plan point in map axes: metres east and metres north of the plan origin, for drawing the
 * plan the way a map shows it, north up.
 */
export function toEastNorth(
  origin: GeoOrigin | undefined,
  p: Vec2,
): { east: number; north: number } {
  const e = bearingInPlan(origin, 90);
  const n = bearingInPlan(origin, 0);
  return { east: p.x * e.x + p.y * e.y, north: p.x * n.x + p.y * n.y };
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The nearest of the eight compass points for a bearing, in English letters. */
export function compassPoint(bearing: number): (typeof COMPASS_POINTS)[number] {
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[index] ?? "N";
}
