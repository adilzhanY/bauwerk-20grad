import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

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
}

/** Tab list with roving focus. The panel is the caller's, linked by id. */
export function CustomTabs<V extends string>({ id, label, value, tabs, onChange }: Props<V>) {
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
  return (
    <div role="tablist" aria-label={label} className="flex border-b border-line px-2">
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
            className={cx(
              "-mb-px flex h-11 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors",
              selected ? "border-select text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.icon}
            {!t.iconOnly && t.label}
          </button>
        );
      })}
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
