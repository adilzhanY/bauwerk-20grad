/**
 * A first estimate of the photovoltaic potential of a roof from its LoD2 roof planes. It is
 * a screening number for a first conversation, not a yield prognosis: no shading, no
 * obstacles on the roof, one typical module.
 */

export interface RoofPlaneInput {
  /** True area of the plane, m². */
  area: number
  /** Compass bearing the plane faces, grid north = 0; null for a flat plane. */
  azimuth: number | null
  /** Tilt from horizontal, degrees. */
  tilt: number
}

export interface PvEstimate {
  /** Roof area that could carry modules, m². */
  usableArea: number
  /** Peak power, kWp. */
  peakPower: number
  /** Expected yield per year, kWh. */
  yearlyYield: number
  /** Yield per month, January first, kWh. */
  monthlyYield: number[]
}

/** Share of a suitable plane left after edges, chimneys and access paths. */
export const USABLE_SHARE = 0.7
/** Peak power per square metre of module, kWp: a typical 20 percent module. */
export const PEAK_PER_M2 = 0.2
/** Specific yield in Berlin for a south facing module at 30 degrees, kWh per kWp and year. */
export const BERLIN_YIELD = 950
/** Flat roofs carry modules on racks tilted about 15 degrees, with gaps against self-shading. */
const FLAT_TILT_DEG = 10
const FLAT_RACK_SHARE = 0.6
/** Planes steeper than this, or facing north on a slope, are left out. */
const MAX_TILT_DEG = 60
const NORTH_LIMIT_DEG = 135
/**
 * Share of the yearly yield per month in Berlin, from long-term irradiation (DWD and PVGIS
 * give the same shape): little in winter, most from April to August. Normalised to sum to 1.
 */
const MONTH_SHARES = normalise([0.024, 0.043, 0.078, 0.113, 0.131, 0.131, 0.132, 0.117, 0.089, 0.063, 0.03, 0.02])

function normalise(values: number[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0)
  return values.map((v) => v / sum)
}

/** Degrees between the plane's facing and south, 0 to 180. */
function offSouth(azimuth: number): number {
  const d = Math.abs((((azimuth - 180) % 360) + 540) % 360 - 180)
  return d
}

/**
 * Yield of a plane relative to the Berlin reference (south, 30 degrees). Tilt: flatter and
 * steeper planes catch a little less. Orientation: east and west lose about a fifth, and the
 * loss grows with the tilt, since a flat module does not care where it faces.
 */
export function orientationFactor(azimuth: number | null, tilt: number): number {
  const t = Math.max(0, Math.min(90, tilt))
  const tiltFactor = t <= 30 ? 0.89 + (0.11 * t) / 30 : Math.max(0.6, 1 - ((t - 30) / 30) * 0.1 - Math.max(0, t - 60) * 0.006)
  if (azimuth === null || t < FLAT_TILT_DEG) return tiltFactor
  const delta = (offSouth(azimuth) * Math.PI) / 180
  const tiltWeight = Math.min(1, Math.sin((t * Math.PI) / 180) / Math.sin(Math.PI / 6))
  return tiltFactor * (1 - ((1 - Math.cos(delta)) / 2) * 0.4 * tiltWeight)
}

/** Whether a plane can carry modules at all: not too steep, and not a north slope. */
export function isSuitable(plane: RoofPlaneInput): boolean {
  if (!(plane.area > 0) || plane.tilt > MAX_TILT_DEG) return false
  if (plane.tilt < FLAT_TILT_DEG || plane.azimuth === null) return true
  return offSouth(plane.azimuth) <= NORTH_LIMIT_DEG
}

export function estimatePv(planes: readonly RoofPlaneInput[]): PvEstimate {
  let usableArea = 0
  let peakPower = 0
  let yearlyYield = 0
  for (const plane of planes) {
    if (!isSuitable(plane)) continue
    const flat = plane.tilt < FLAT_TILT_DEG || plane.azimuth === null
    const area = plane.area * USABLE_SHARE * (flat ? FLAT_RACK_SHARE : 1)
    const peak = area * PEAK_PER_M2
    // Modules on a flat roof are racked towards the south at a low tilt.
    const factor = flat ? orientationFactor(180, 15) : orientationFactor(plane.azimuth, plane.tilt)
    usableArea += area
    peakPower += peak
    yearlyYield += peak * BERLIN_YIELD * factor
  }
  return {
    usableArea,
    peakPower,
    yearlyYield,
    monthlyYield: MONTH_SHARES.map((share) => share * yearlyYield),
  }
}
