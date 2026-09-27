import type { ReactNode } from "react";
import { cx } from "./cx.ts";

/** Small explanatory line under a control or a table, or an error in the mark colour. */
export function Hint({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={cx("text-xs leading-relaxed", error ? "text-mark" : "text-muted")}>{children}</p>
  );
}
