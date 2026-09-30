/**
 * What an edit did to the energy balance: the figures that moved between the result before and
 * the result after, the plan's first (area, windows, losses), then what they cost in energy.
 * The Energy panel shows it after every change, so the consultant sees the model react.
 */
import type { EnergySummary } from "./energy";
import type { SupplySummary } from "./supply";

export type DeltaKey =
  "referenceArea" | "windowArea" | "transmissionLoss" | "endPerM2" | "primaryPerM2" | "co2";

export interface DeltaItem {
  key: DeltaKey;
  before: number;
  after: number;
  delta: number;
}

interface Result {
  energy: EnergySummary;
  supply: SupplySummary;
}

/** Each figure, where it is read from, and the smallest move worth telling. */
const FIGURES: readonly { key: DeltaKey; read: (r: Result) => number; min: number }[] = [
  { key: "referenceArea", read: (r) => r.energy.referenceArea, min: 0.05 },
  { key: "windowArea", read: (r) => r.energy.windowArea, min: 0.01 },
  { key: "transmissionLoss", read: (r) => r.energy.transmissionLoss, min: 0.05 },
  { key: "endPerM2", read: (r) => r.supply.endPerM2, min: 0.05 },
  { key: "primaryPerM2", read: (r) => r.supply.primaryPerM2, min: 0.05 },
  { key: "co2", read: (r) => r.supply.co2, min: 1 },
];

/** The figures that moved from `before` to `after`, in the order above. */
export function energyDelta(before: Result, after: Result): DeltaItem[] {
  return FIGURES.flatMap(({ key, read, min }) => {
    const b = read(before);
    const a = read(after);
    return Math.abs(a - b) >= min ? [{ key, before: b, after: a, delta: a - b }] : [];
  });
}
