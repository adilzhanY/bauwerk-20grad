/**
 * ETRS89 / UTM to latitude and longitude, for placing a building on the map in the editor.
 *
 * The inverse transverse Mercator series on the GRS80 ellipsoid (Snyder, "Map Projections:
 * A Working Manual", 1987, formulas 8-17 to 8-25). Accurate to well under a metre in the
 * zone, which is all a plan origin needs.
 */

const A = 6378137
const F = 1 / 298.257222101
const K0 = 0.9996
const FALSE_EASTING = 500000

export function utmToLatLon(easting: number, northing: number, zone: number): { lat: number; lon: number } {
  const e2 = F * (2 - F)
  const ep2 = e2 / (1 - e2)
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const x = easting - FALSE_EASTING
  const m = northing / K0
  const mu = m / (A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256))
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu)
  const sin = Math.sin(phi1)
  const cos = Math.cos(phi1)
  const tan = Math.tan(phi1)
  const n1 = A / Math.sqrt(1 - e2 * sin * sin)
  const t1 = tan * tan
  const c1 = ep2 * cos * cos
  const r1 = (A * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5
  const d = x / (n1 * K0)
  const lat =
    phi1 -
    ((n1 * tan) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720)
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180)
  const lon =
    lon0 +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) /
      cos
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI }
}
