import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * The small explanatory line under a control, a table or a section, or, with `error`, the
 * problem in the mark colour, announced to screen readers. Every hint and inline error on
 * the site is this, so they all read alike.
 */
export function Hint({
  children,
  error = false,
  className,
  id,
}: {
  children: ReactNode;
  error?: boolean;
  className?: string;
  /** For a control that points at it with aria-describedby. */
  id?: string;
}) {
  return (
    <p
      id={id}
      role={error ? "alert" : undefined}
      className={cx("text-xs leading-relaxed", error ? "text-mark" : "text-muted", className)}
    >
      {children}
    </p>
  );
}
