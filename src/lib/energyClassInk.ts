import { ENERGY_CLASS_COLORS } from "@/geometry/energy";
import type { EnergyClass } from "@/geometry/energy";

/** The dark ink of the site (--fixed-ink), for letters on the light classes. */
const DARK = "#0d2137";
const LIGHT = "#ffffff";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The letter colour on each class's background: whichever of dark and white reads better. */
export const ENERGY_CLASS_INK = Object.fromEntries(
  Object.entries(ENERGY_CLASS_COLORS).map(([id, bg]) => [
    id,
    contrast(bg, DARK) >= contrast(bg, LIGHT) ? DARK : LIGHT,
  ]),
) as Record<EnergyClass, string>;

/** The classes in order, best first, as the certificate's scale shows them. */
export const ENERGY_CLASS_ORDER = Object.keys(ENERGY_CLASS_COLORS) as EnergyClass[];
