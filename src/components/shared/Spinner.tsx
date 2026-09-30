import { cx } from "./cx";

/** The one loading spinner: a ring in the current text colour, still under reduced motion. */
export function Spinner({ size = "sm", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
        size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5",
        className,
      )}
    />
  );
}
