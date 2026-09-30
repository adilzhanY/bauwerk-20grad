import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";

export type ButtonVariant = "default" | "primary" | "quiet" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  /** "md" in panels and bars; "lg" for the one main action of a page. */
  size?: "md" | "lg";
}

const variants: Record<ButtonVariant, string> = {
  default: "border-line bg-paper text-ink hover:border-line-strong hover:bg-panel-2",
  primary: "border-select bg-select text-white hover:border-select-strong hover:bg-select-strong",
  quiet: "border-transparent bg-transparent text-ink hover:bg-panel-2",
  danger: "border-line bg-paper text-mark hover:border-mark hover:bg-mark-soft",
};

/** Text button. Keyboard focus is drawn by the global focus ring. */
export function CustomButton({
  variant = "default",
  icon,
  loading = false,
  size = "md",
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      disabled={(disabled ?? false) || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-control border text-sm font-medium transition-colors",
        size === "md" ? "h-9 px-3" : "h-11 px-5 font-semibold",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
