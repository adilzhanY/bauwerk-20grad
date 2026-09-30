import { ENERGY_CLASS_COLORS } from "@/geometry/energy";
import type { EnergyClass } from "@/geometry/energy";
import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * An energy class (A+ to H) on its colour from the official scale. The one badge for it
 * everywhere: project cards, the project bar, the scenario table. The colours are the same
 * in both themes, so the letter is always dark.
 */
export function EnergyClassBadge({
  value,
  detail,
  className,
}: {
  value: EnergyClass;
  /** After the letter, such as the specific end energy. */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "rounded-soft px-2 py-0.5 font-num text-xs font-bold text-fixed-ink",
        className,
      )}
      style={{ background: ENERGY_CLASS_COLORS[value] }}
    >
      {value}
      {detail !== undefined && <> · {detail}</>}
    </span>
  );
}
