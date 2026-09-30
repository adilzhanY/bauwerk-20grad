import { useState } from "react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Leaving } from "./presenceMotion";
import { MOTION_MS, usePresence } from "./usePresence";

/**
 * How a Presence enters and leaves. Both use the same duration and easing (the --motion-*
 * tokens in index.css), so everything on the site appears and disappears alike.
 *
 * - "flow": for blocks in the page flow (cards, notices, rows, panels). Fades, rises a few
 *   pixels and opens its height, so what is below slides instead of jumping.
 * - "float": for things over the page (dialogs, menus, popovers, toasts), and for rows of a
 *   list or tree. Presence adds no element of its own here: a transformed wrapper would
 *   become the frame that fixed and absolute children are placed in, and an li cannot sit
 *   in a div. The element puts the class of useFloatMotion() (fades and grows from 98
 *   percent) or useRowMotion() (fades and slides) from presenceMotion.ts on its own root.
 */
export type PresenceKind = "flow" | "float";

type Props<T> = {
  kind?: PresenceKind;
  /**
   * Layout of the content ("flow" only), such as "flex flex-col gap-3" when it holds several
   * controls that should keep the spacing of the column around them.
   */
  className?: string;
} & (
  | {
      /** Content that depends on a value: it keeps its last value on screen while it leaves. */
      value: T | null | undefined;
      children: (value: T) => ReactNode;
      show?: never;
    }
  | {
      /** Content that is always the same, shown while `show` is true. */
      show: boolean;
      children: ReactNode;
      value?: never;
    }
);

/**
 * The one way something appears or disappears on this site. It enters with the site's
 * animation when it mounts and plays the matching exit before it unmounts:
 *
 *   <Presence value={result}>{(r) => <ResultCard result={r} />}</Presence>
 *   <Presence show={open} kind="float"><Menu /></Presence>
 */
export function Presence<T>({ kind = "flow", className, ...props }: Props<T>) {
  const present: T | true | null =
    props.show !== undefined ? (props.show ? true : null) : (props.value ?? null);
  const { shown, leaving } = usePresence(present, MOTION_MS);
  // The height is clipped only while it moves, so shadows and focus rings are not cut off.
  const [settled, setSettled] = useState(false);
  if (shown === null) {
    if (settled) setSettled(false);
    return null;
  }
  const content =
    typeof props.children === "function"
      ? (props.children as (value: T) => ReactNode)(shown as T)
      : props.children;

  if (kind === "float") return <Leaving value={leaving}>{content}</Leaving>;
  return (
    <div
      className={cx("motion-flow", leaving ? "motion-flow-out" : "motion-flow-in")}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && !leaving) setSettled(true);
      }}
    >
      <div className={cx("min-h-0", (!settled || leaving) && "overflow-hidden", className)}>
        {content}
      </div>
    </div>
  );
}
