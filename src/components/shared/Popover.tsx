import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { useFloatMotion } from "./presenceMotion";

/**
 * The one floating panel of the site, for menus and popovers: a card over the page with the
 * float motion. Place it with `className` (absolute position and width), open it inside
 * `<Presence show={open} kind="float">` and close it with useDismiss.
 */
export function Popover({
  padding = "panel",
  className,
  children,
  ...rest
}: {
  /** "menu" for a list of MenuItems, "panel" for anything else. */
  padding?: "menu" | "panel";
  className?: string;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  const motion = useFloatMotion();
  return (
    <div
      className={cx(
        "z-40 flex flex-col rounded-card border border-line bg-paper shadow-float",
        padding === "menu" ? "p-1" : "p-4",
        motion,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A row of a menu: an icon and a label, the whole row clickable. */
export function MenuItem({
  icon,
  disabled,
  onClick,
  children,
}: {
  icon?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-ink transition-colors hover:bg-panel-2 disabled:opacity-40"
    >
      {icon !== undefined && (
        <span aria-hidden className="text-muted">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
