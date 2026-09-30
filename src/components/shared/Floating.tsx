import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { useFadeMotion, useFloatMotion } from "./presenceMotion";

/**
 * A plain element that enters and leaves with the site's motion when it sits in a
 * `<Presence kind="float">`: for something placed absolutely over a view (a minimap, an
 * attribution) or a docked panel, which no flow wrapper may go around. `fade` only fades,
 * for large surfaces such as a side panel.
 */
export function Floating({
  fade = false,
  className,
  children,
  ...rest
}: { fade?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const float = useFloatMotion();
  const fadeMotion = useFadeMotion();
  return (
    <div className={cx(fade ? fadeMotion : float, className)} {...rest}>
      {children}
    </div>
  );
}
