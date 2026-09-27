import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and tooltip. */
  label: string;
  pressed?: boolean;
  size?: "sm" | "md";
}

/** Square icon-only button. `pressed` makes it a toggle with aria-pressed. */
export function CustomIconButton({
  label,
  pressed,
  size = "md",
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center rounded-control border transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-9 w-7" : "h-11 w-11",
        pressed
          ? "border-select bg-select-soft text-select"
          : "border-transparent text-muted hover:bg-panel-2 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
