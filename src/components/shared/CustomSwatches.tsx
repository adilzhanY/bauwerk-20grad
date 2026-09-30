import type { KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { ZONE_COLORS } from "@/lib/colors";
import { cx } from "@/components/shared/cx";

interface Props {
  label: string;
  value: string;
  onChange: (color: string) => void;
  colors?: readonly string[];
}

/** Radiogroup of coloured circles. Arrow keys move, Space and Enter pick. */
export function CustomSwatches({ label, value, onChange, colors = ZONE_COLORS }: Props) {
  const index = colors.indexOf(value);
  const onKeyDown = (e: KeyboardEvent) => {
    const delta =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = colors[(index + delta + colors.length) % colors.length];
    if (next) onChange(next);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {colors.map((color) => {
          const selected = color === value;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={color}
              title={color}
              tabIndex={selected || (index === -1 && color === colors[0]) ? 0 : -1}
              onKeyDown={onKeyDown}
              onClick={() => {
                onChange(color);
              }}
              className={cx(
                "flex h-9 w-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-110",
                selected ? "border-ink" : "border-transparent",
              )}
              style={{ background: color }}
            >
              {selected && (
                <Check
                  size={14}
                  strokeWidth={3}
                  className="text-paper mix-blend-difference"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
