/**
 * Solar position after the NOAA Solar Calculator algorithm (Meeus, Astronomical
 * Algorithms), accurate to about 0.1 degree for the years 1900 to 2100.
 * Inputs are UTC; the interface converts local time. Angles in degrees.
 */

export interface SunPosition {
  /** Degrees above the horizon, negative below. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Solar declination in degrees. */
  declination: number;
  /** Equation of time in minutes. */
  equationOfTime: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Julian day for a UTC date and fractional hour. */
export function julianDay(year: number, month: number, day: number, hourUtc: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    b -
    1524.5 +
    hourUtc / 24
  );
}

interface Orbit {
  declination: number;
  equationOfTime: number;
}

function orbit(jd: number): Orbit {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * m)) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eot =
    4 *
    deg(
      y * Math.sin(2 * rad(l0)) -
        2 * e * Math.sin(rad(m)) +
        4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
        0.5 * y * y * Math.sin(4 * rad(l0)) -
        1.25 * e * e * Math.sin(2 * rad(m)),
    );
  return { declination, equationOfTime: eot };
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const hourUtc = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const jd = julianDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hourUtc);
  const { declination, equationOfTime } = orbit(jd);
  const minutes = hourUtc * 60;
  const tst = (((minutes + equationOfTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const phi = rad(lat);
  const delta = rad(declination);
  const cosZenith =
    Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(rad(hourAngle));
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  const elevation = 90 - zenith;
  let azimuth: number;
  const denom = Math.cos(phi) * Math.sin(rad(zenith));
  if (Math.abs(denom) < 1e-9) azimuth = 180;
  else {
    const cosAz = Math.min(
      1,
      Math.max(-1, (Math.sin(phi) * Math.cos(rad(zenith)) - Math.sin(delta)) / denom),
    );
    const az = deg(Math.acos(cosAz));
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  }
  return { elevation, azimuth, declination, equationOfTime };
}

/** Sunrise and sunset as UTC minutes past midnight for the date, or null for polar day and night. */
export function sunriseSunset(
  date: Date,
  lat: number,
  lon: number,
): { sunrise: number; sunset: number } | null {
  const jd = julianDay(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), 12);
  const { declination, equationOfTime } = orbit(jd);
  const phi = rad(lat);
  const delta = rad(declination);
  const cosHa =
    Math.cos(rad(90.833)) / (Math.cos(phi) * Math.cos(delta)) - Math.tan(phi) * Math.tan(delta);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = deg(Math.acos(cosHa));
  const noon = 720 - 4 * lon - equationOfTime;
  return { sunrise: noon - 4 * ha, sunset: noon + 4 * ha };
}

/** Sun positions through a day at the given step, for drawing the path. */
export function sunPath(date: Date, lat: number, lon: number, stepMinutes = 30): SunPosition[] {
  const out: SunPosition[] = [];
  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  for (let m = 0; m < 1440; m += stepMinutes) {
    const d = new Date(base.getTime() + m * 60000);
    const p = sunPosition(d, lat, lon);
    if (p.elevation > 0) out.push(p);
  }
  return out;
}

/**
 * Solar gains through windows over the heating period after the simple method of
 * DIN V 4108-6: Q_s = Σ A_w · g⊥ · F_W · F_F · F_S · I_orient, with each window's own g⊥
 * (0.87 single, 0.75 double, 0.6 thermal, 0.5 triple glazing; GLAZING_G when unknown), the
 * factor for radiation not arriving square to the pane F_W = 0.9, frame factor F_F = 0.7,
 * shading factor F_S = 0.9, and I_orient the global irradiation on a vertical surface summed
 * over the heating period for the German reference climate (kWh/(m²·heating period)): south
 * 270, east and west 155, north 100. A utilisation factor of 0.95 covers the share that
 * arrives when heating is not needed.
 */
export const HEATING_PERIOD_IRRADIATION: Record<"N" | "E" | "S" | "W", number> = {
  N: 100,
  E: 155,
  S: 270,
  W: 155,
};
export const GLAZING_G = 0.6;
export const NOT_SQUARE_FACTOR = 0.9;
export const FRAME_FACTOR = 0.7;
export const SHADING_FACTOR = 0.9;
export const GAIN_UTILISATION = 0.95;

/** Usable solar gains, kWh/a, from the window area times g⊥ per orientation. */
export function solarGains(glazedAreaTimesG: Record<"N" | "E" | "S" | "W", number>): number {
  return (["N", "E", "S", "W"] as const).reduce(
    (s, o) =>
      s +
      glazedAreaTimesG[o] *
        NOT_SQUARE_FACTOR *
        FRAME_FACTOR *
        SHADING_FACTOR *
        HEATING_PERIOD_IRRADIATION[o] *
        GAIN_UTILISATION,
    0,
  );
}
