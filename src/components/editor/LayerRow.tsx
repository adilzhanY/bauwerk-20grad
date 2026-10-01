import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { useT } from "@/i18n/useT";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { cx } from "@/components/shared/cx";
import { Presence } from "@/components/shared/Presence";
import { useRowMotion } from "@/components/shared/presenceMotion";

/** A folder in the tree: its name and count, closed until opened. */
export function LayerGroup({
  label,
  count,
  level = 2,
  icon,
  actions,
  alwaysOpenable = false,
  children,
}: {
  label: string;
  count: number;
  level?: number;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Opens even at a count of 0, for a folder that lists what is still missing. */
  alwaysOpenable?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const openable = alwaysOpenable || count > 0;
  return (
    <>
      <LayerRow
        level={level}
        icon={icon}
        label={label}
        meta={String(count)}
        muted={level >= 2}
        actions={actions}
        open={openable ? open : undefined}
        onToggleOpen={() => {
          setOpen(!open);
        }}
        onSelect={() => {
          if (openable) setOpen(!open);
        }}
      />
      <Presence show={open} kind="float">
        {children}
      </Presence>
    </>
  );
}

/**
 * One row of the tree, as in Figma's layers: indent, disclosure arrow, icon, name, a value on
 * the right, and on hover the row's actions and its eye. The eye stays visible while hidden.
 */
export function LayerRow({
  level,
  icon,
  label,
  meta,
  selected = false,
  strong = false,
  current = false,
  muted = false,
  open,
  onToggleOpen,
  onSelect,
  onKeyDown,
  hidden,
  onToggleHidden,
  actions,
  onHover,
}: {
  level: number;
  icon?: ReactNode;
  label: string;
  meta?: string;
  selected?: boolean;
  strong?: boolean;
  current?: boolean;
  muted?: boolean;
  open?: boolean;
  onToggleOpen?: () => void;
  onSelect: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  hidden?: boolean;
  onToggleHidden?: () => void;
  actions?: ReactNode;
  /** The pointer or the keyboard focus came onto the row (true) or left it (false). */
  onHover?: (on: boolean) => void;
}) {
  const t = useT();
  // Rows under a storey or a group fade in as it opens and out as it closes.
  const motion = useRowMotion();
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-expanded={open}
      className={cx(
        "group relative flex h-8 items-center rounded-soft pr-1 transition-colors",
        selected ? "bg-select-soft" : "hover:bg-panel",
        motion,
      )}
      style={{ paddingLeft: 4 + level * 14 }}
      onPointerEnter={
        onHover &&
        (() => {
          onHover(true);
        })
      }
      onPointerLeave={
        onHover &&
        (() => {
          onHover(false);
        })
      }
      onFocus={
        onHover &&
        (() => {
          onHover(true);
        })
      }
      onBlur={
        onHover &&
        (() => {
          onHover(false);
        })
      }
    >
      {current && (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-select"
        />
      )}
      <span className="flex h-6 w-5 shrink-0 items-center justify-center">
        {open !== undefined && onToggleOpen && (
          <button
            type="button"
            aria-label={open ? t("tree.collapse") : t("tree.expand")}
            onClick={onToggleOpen}
            className="flex h-6 w-5 items-center justify-center text-faint hover:text-ink"
          >
            <ChevronRight size={13} className={cx("transition-transform", open && "rotate-90")} />
          </button>
        )}
      </span>
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={cx(
          "flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-sm",
          hidden && "opacity-45",
        )}
      >
        {icon && (
          <span
            className={cx(
              "flex w-4 shrink-0 justify-center",
              selected ? "text-select" : "text-muted",
            )}
          >
            {icon}
          </span>
        )}
        <span
          className={cx(
            "min-w-0 flex-1 truncate",
            muted ? "text-xs text-muted" : "text-ink",
            strong && "font-semibold",
          )}
        >
          {label}
        </span>
        {meta && (
          <span className="shrink-0 font-num text-[11px] text-faint group-hover:hidden">
            {meta}
          </span>
        )}
      </button>
      {actions && <span className="hidden shrink-0 items-center group-hover:flex">{actions}</span>}
      {onToggleHidden && (
        <RowAction
          label={hidden ? t("tree.show") : t("tree.hide")}
          onClick={onToggleHidden}
          className={hidden ? "flex" : "hidden group-hover:flex"}
        >
          {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </RowAction>
      )}
    </li>
  );
}

export function RowAction({
  label,
  disabled,
  pressed,
  onClick,
  className,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** Drawn pressed, as a delete that waits for its second click. */
  pressed?: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `className` shows or hides the action on row hover, so it sits on a wrapper: the
    // button keeps its own display.
    <span className={cx("shrink-0", className ?? "flex")}>
      <CustomIconButton
        label={label}
        size="xs"
        disabled={disabled}
        pressed={pressed}
        onClick={onClick}
      >
        {children}
      </CustomIconButton>
    </span>
  );
}
