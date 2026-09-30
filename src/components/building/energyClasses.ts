import type { EnergyClass } from "@/geometry/energy";

/** The classes of the energy certificate, best first, with their colours on the scale. */
export const ENERGY_CLASSES: readonly { id: EnergyClass; color: string }[] = [
  { id: "A+", color: "#1f9d4c" },
  { id: "A", color: "#39b54a" },
  { id: "B", color: "#8cc63f" },
  { id: "C", color: "#cbd422" },
  { id: "D", color: "#f2c515" },
  { id: "E", color: "#f5a31a" },
  { id: "F", color: "#ef7a22" },
  { id: "G", color: "#e5452c" },
  { id: "H", color: "#d31f2d" },
];
