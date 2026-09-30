import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type IconButtonSize = "xs" | "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and tooltip. */
  label: string;
  /** Makes it a toggle with aria-pressed. */
  pressed?: boolean;
  /** xs 24 px (tree rows), sm 32 px (card headers, notices), md 36 px (toolbars), lg 44 px. */
  size?: IconButtonSize;
  /**
   * "ghost" sits on a panel or card; "floating" stands on its own over the map or the 3D
   * view, with a border and a shadow.
   */
  variant?: "ghost" | "floating";
  /** How a pressed toggle shows: a soft tint, or the solid navy of an active tool. */
  pressedStyle?: "soft" | "solid";
}

const SIZES: Record<IconButtonSize, string> = {
  xs: "h-6 w-6 rounded-soft",
  sm: "h-8 w-8 rounded-control",
  md: "h-9 w-9 rounded-control",
  lg: "h-11 w-11 rounded-control",
};

/** The one square icon-only button of the site. */
export function CustomIconButton({
  label,
  pressed,
  size = "md",
  variant = "ghost",
  pressedStyle = "soft",
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
        "relative inline-flex shrink-0 items-center justify-center border transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        SIZES[size],
        variant === "floating" && "shadow-float",
        pressed
          ? pressedStyle === "solid"
            ? "border-select bg-select text-white"
            : "border-transparent bg-select-soft text-select"
          : variant === "floating"
            ? "border-line bg-paper text-muted hover:bg-panel-2 hover:text-ink"
            : "border-transparent text-muted hover:bg-panel-2 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
