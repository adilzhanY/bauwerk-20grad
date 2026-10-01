import type { ReactNode } from "react";
import { cx } from "@/components/shared/cx";
import { useRowMotion } from "@/components/shared/presenceMotion";

/**
 * One line of the survey panel: an icon or thumbnail, the name, a value in grey, and on the
 * right what to do next (add a photo, add a plan), always in view. The pointer or the focus on
 * the row reports `onHover`, so the 3D view can light what the row is about.
 */
export function SurveyRow({
  icon,
  label,
  meta,
  muted = false,
  strong = false,
  indent = false,
  selected = false,
  onSelect,
  onHover,
  action,
}: {
  icon?: ReactNode;
  label: string;
  meta?: string;
  muted?: boolean;
  /** The head of a block, such as a storey over its plan and rooms. */
  strong?: boolean;
  /** A line that belongs to the row above it. */
  indent?: boolean;
  selected?: boolean;
  onSelect: () => void;
  onHover?: (on: boolean) => void;
  action?: ReactNode;
}) {
  const motion = useRowMotion();
  const hover = onHover && {
    onPointerEnter: () => {
      onHover(true);
    },
    onPointerLeave: () => {
      onHover(false);
    },
    onFocus: () => {
      onHover(true);
    },
    onBlur: () => {
      onHover(false);
    },
  };
  return (
    <li
      className={cx(
        "flex min-h-9 items-center gap-1 rounded-soft pr-1 transition-colors",
        indent ? "pl-6" : "pl-2",
        selected ? "bg-select-soft" : "hover:bg-panel",
        motion,
      )}
      {...hover}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected || undefined}
        className="flex min-h-9 min-w-0 flex-1 items-center gap-2.5 text-left text-sm"
      >
        {icon && (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted">
            {icon}
          </span>
        )}
        <span
          className={cx(
            "min-w-0 flex-1 truncate",
            muted ? "text-muted" : "text-ink",
            strong && "font-semibold",
          )}
        >
          {label}
        </span>
        {meta && <span className="shrink-0 font-num text-[11px] text-faint">{meta}</span>}
      </button>
      {action && <span className="flex shrink-0 items-center">{action}</span>}
    </li>
  );
}

/** A small picture as a row's icon, so the list shows what it holds. */
export function Thumb({ url }: { url: string }) {
  return <img src={url} alt="" draggable={false} className="h-6 w-6 rounded-sm object-cover" />;
}
