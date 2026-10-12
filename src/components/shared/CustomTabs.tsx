import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { cx } from "@/components/shared/cx";

export interface TabItem<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  /** Shows the icon only; the label becomes the accessible name and the tooltip. */
  iconOnly?: boolean;
}

interface Props<V extends string> {
  id: string;
  label: string;
  value: V;
  tabs: readonly TabItem<V>[];
  onChange: (value: V) => void;
  /** "underline": larger labels in one scrolling row, as for the parts of a building. */
  variant?: "default" | "underline";
  /** Underline variant: the label of the arrow that scrolls the row further. */
  moreLabel?: string;
}

/** Tab list with roving focus. The panel is the caller's, linked by id. */
export function CustomTabs<V extends string>({
  id,
  label,
  value,
  tabs,
  onChange,
  variant = "default",
  moreLabel,
}: Props<V>) {
  const row = useRef<HTMLDivElement>(null);
  const underline = variant === "underline";
  const selectedIndex = tabs.findIndex((t) => t.value === value);
  const index = selectedIndex < 0 ? 0 : selectedIndex;
  const onKeyDown = (e: KeyboardEvent) => {
    const nextIndex =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : e.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : e.key === "ArrowLeft"
              ? (index - 1 + tabs.length) % tabs.length
              : -1;
    if (nextIndex < 0) return;
    e.preventDefault();
    const next = tabs[nextIndex];
    if (next) {
      onChange(next.value);
      (
        e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined
      )?.focus();
    }
  };
  const list = (
    // The first tab's text lines up with the fields below it, not indented past their edge.
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      className={
        underline
          ? "flex min-w-0 flex-1 gap-8 overflow-x-auto [scrollbar-width:none]"
          : "flex gap-1 border-b border-line"
      }
    >
      {tabs.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${id}-tab-${t.value}`}
            aria-selected={selected}
            aria-label={t.iconOnly ? t.label : undefined}
            title={t.iconOnly ? t.label : undefined}
            aria-controls={`${id}-panel-${t.value}`}
            tabIndex={selected || (selectedIndex < 0 && tabs[0] === t) ? 0 : -1}
            onClick={() => {
              onChange(t.value);
            }}
            onKeyDown={onKeyDown}
            className={
              underline
                ? cx(
                    "-mb-px shrink-0 border-b-2 pb-3 text-[15px] whitespace-nowrap transition-colors",
                    selected
                      ? "border-ink font-medium text-ink"
                      : "border-transparent text-muted hover:text-ink",
                  )
                : cx(
                    "-mb-px flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors first:pl-0",
                    selected
                      ? "border-select text-ink"
                      : "border-transparent text-muted hover:text-ink",
                  )
            }
          >
            {t.icon}
            {!t.iconOnly && t.label}
          </button>
        );
      })}
    </div>
  );
  if (!underline) return list;
  return (
    <div className="relative flex items-end border-b border-line">
      {list}
      {moreLabel && (
        <CustomIconButton
          label={moreLabel}
          size="xs"
          className="mb-3 ml-2"
          onClick={() => row.current?.scrollBy({ left: 160, behavior: "smooth" })}
        >
          <ChevronRight size={16} aria-hidden />
        </CustomIconButton>
      )}
    </div>
  );
}

export function CustomTabPanel({
  id,
  value,
  children,
}: {
  id: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${id}-panel-${value}`}
      aria-labelledby={`${id}-tab-${value}`}
      className="flex flex-col"
    >
      {children}
    </div>
  );
}
