import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * A round chip: a filter that is on or off (`pressed`), or a quick choice such as an example
 * building. The one chip of the site.
 */
export function CustomChip({
  pressed,
  className,
  children,
  ...rest
}: { pressed?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cx(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        pressed
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paper text-muted hover:bg-panel-2 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
