import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx.ts";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

interface Props<V extends string> {
  label: string;
  value: V;
  options: readonly SegmentOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Stack vertically. */
  vertical?: boolean;
  /** Icon-only buttons with the label as tooltip. */
  iconsOnly?: boolean;
}

/** Mutually exclusive options as a radiogroup. Arrow keys move, roving tabindex. */
export function CustomSegmented<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  vertical = false,
  iconsOnly = false,
}: Props<V>) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const index = selectedIndex < 0 ? 0 : selectedIndex;

  const nextIndexFor = (key: string): number => {
    const forward =
      key === (vertical ? "ArrowDown" : "ArrowRight") ||
      key === (vertical ? "ArrowRight" : "ArrowDown");
    const back =
      key === (vertical ? "ArrowUp" : "ArrowLeft") || key === (vertical ? "ArrowLeft" : "ArrowUp");
    if (key === "Home") return 0;
    if (key === "End") return options.length - 1;
    if (forward) return (index + 1) % options.length;
    if (back) return (index - 1 + options.length) % options.length;
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const nextIndex = nextIndexFor(e.key);
    if (nextIndex < 0) return;
    e.preventDefault();
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    const button = e.currentTarget.parentElement?.children[nextIndex] as HTMLElement | undefined;
    button?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        "flex overflow-hidden rounded-control border border-line bg-panel",
        vertical && "flex-col",
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            role="radio"
            aria-checked={selected}
            aria-label={iconsOnly ? o.label : undefined}
            title={o.hint ? `${o.label} (${o.hint})` : o.label}
            tabIndex={selected || (selectedIndex < 0 && options[0] === o) ? 0 : -1}
            onClick={() => {
              onChange(o.value);
            }}
            onKeyDown={onKeyDown}
            className={cx(
              "relative flex items-center justify-center gap-1.5 transition-colors",
              // Flex items refuse to shrink below their text by default, so min-w-0 lets
              // them share the width, and dense groups drop to the smaller size.
              iconsOnly
                ? o.hint
                  ? "h-9 px-3 text-sm"
                  : "h-9 w-9 text-sm"
                : cx("h-8 min-w-0 flex-1", options.length > 3 ? "px-2 text-xs" : "px-3 text-sm"),
              selected
                ? "bg-select font-semibold text-white"
                : "text-muted hover:bg-panel-2 hover:text-ink",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {o.icon}
            {!iconsOnly && <span className="truncate">{o.label}</span>}
            {iconsOnly && o.hint && (
              <span aria-hidden className="font-num text-xs leading-none opacity-70">
                {o.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
