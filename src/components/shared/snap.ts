const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Clamps to [min, max] and snaps to the nearest step from min. */
export function snapToStep(raw: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, raw));
  const steps = Math.round((clamped - min) / step);
  return round(Math.min(max, min + steps * step));
}
