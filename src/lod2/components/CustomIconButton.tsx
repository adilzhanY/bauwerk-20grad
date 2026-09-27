import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.ts";

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
        size === "sm" ? "h-[34px] w-[34px]" : "h-10 w-10",
        pressed
          ? "border-select bg-select-soft text-select"
          : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
