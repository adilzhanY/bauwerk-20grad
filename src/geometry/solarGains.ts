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
