import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

export type ButtonVariant = "default" | "primary" | "quiet" | "danger";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  default: "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
  primary: "border-select bg-select text-white font-semibold hover:opacity-90",
  quiet: "border-transparent bg-transparent text-select hover:bg-select-soft",
  danger: "border-line bg-panel text-mark hover:border-mark hover:bg-mark-soft",
};

/** Text button. Keyboard focus is drawn by the global focus ring. */
export function CustomButton({
  variant = "default",
  icon,
  loading = false,
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
        "inline-flex h-[34px] items-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors",
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

/** Small spinning ring in the current text colour. */
export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
    />
  );
}
