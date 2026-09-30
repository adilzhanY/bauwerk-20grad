import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronDown, Check } from "lucide-react";
import { CustomField } from "@/components/shared/CustomField";
import { cx } from "@/components/shared/cx";
import { usePresence } from "@/components/shared/usePresence";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  /** Small colour dot before the label. */
  color?: string;
  /** Secondary text after the label, in mono. */
  detail?: string;
  disabled?: boolean;
}

interface Props<V extends string> {
  label: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
}

/**
 * Own listbox. The trigger is a combobox button; the popover is a listbox with
 * arrow keys, Home and End, type-ahead, Enter to pick, Escape to close, and an
 * outside click closes it too.
 */
export function CustomSelect<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
}: Props<V>) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  // The list plays its exit before it goes, like every floating element.
  const list = usePresence(open ? true : null);
  const [highlight, setHighlight] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const openList = () => {
    if (disabled) return;
    typed.current = { text: "", at: 0 };
    setHighlight(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const pick = (index: number) => {
    const o = options[index];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    button.current?.focus();
  };
  const move = (from: number, delta: number) => {
    let i = from;
    let remaining = options.length;
    while (remaining > 0) {
      remaining -= 1;
      i = (i + delta + options.length) % options.length;
      if (!options[i]?.disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setHighlight((h) => move(h, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else setHighlight((h) => move(h, -1));
        return;
      case "Home":
        if (open) {
          e.preventDefault();
          setHighlight(move(-1, 1));
        }
        return;
      case "End":
        if (open) {
          e.preventDefault();
          setHighlight(move(0, -1));
        }
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) pick(highlight);
        else openList();
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
        }
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const now = Date.now();
          const text = now - typed.current.at < 700 ? typed.current.text + e.key : e.key;
          typed.current = { text: text.toLowerCase(), at: now };
          const index = options.findIndex(
            (o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text),
          );
          if (index !== -1) {
            if (open) setHighlight(index);
            else pick(index);
          }
        }
    }
  };

  return (
    <CustomField
      label={label}
      htmlFor={id}
      labelProps={hideLabel ? { className: "sr-only" } : undefined}
    >
      <div ref={root} className="relative">
        <button
          ref={button}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
          disabled={disabled}
          onClick={() => {
            if (open) setOpen(false);
            else openList();
          }}
          onKeyDown={onKeyDown}
          className={cx(
            "flex h-10 w-full items-center gap-2 rounded-inner border bg-paper px-3 text-left text-sm text-ink transition-colors",
            open ? "border-select" : "border-line hover:border-line-strong",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {current?.color && (
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: current.color }}
            />
          )}
          <span className="flex-1 truncate">{current?.label ?? ""}</span>
          {current?.detail && <span className="font-num text-xs text-muted">{current.detail}</span>}
          <ChevronDown
            size={14}
            className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")}
          />
        </button>
        {list.shown && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className={cx(
              "absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-line bg-paper p-1 shadow-float",
              list.leaving ? "motion-float-out" : "motion-float-in",
            )}
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled ? true : undefined}
                  onPointerEnter={() => {
                    setHighlight(i);
                  }}
                  onClick={() => {
                    pick(i);
                  }}
                  className={cx(
                    "flex items-center gap-2 rounded-soft px-2 py-2 text-sm",
                    i === highlight && "bg-panel-2",
                    o.disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  {o.color && (
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: o.color }}
                    />
                  )}
                  <span className="flex-1 truncate text-ink">{o.label}</span>
                  {o.detail && <span className="font-num text-xs text-muted">{o.detail}</span>}
                  {selected && <Check size={14} className="text-select" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CustomField>
  );
}
