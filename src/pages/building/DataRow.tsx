import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * One line of building data: the label with an optional info tip, and the value on the
 * right. Rows are separated by hairlines, the way the reference building page lists them.
 */
export function DataRow({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <div className="relative flex min-h-12 items-center justify-between gap-4 border-b border-line py-2.5">
      <span className="flex items-center gap-1.5 text-sm text-muted">
        {label}
        {info && (
          <button
            type="button"
            aria-label={info}
            aria-describedby={open ? tipId : undefined}
            onMouseEnter={() => {
              setOpen(true);
            }}
            onMouseLeave={() => {
              setOpen(false);
            }}
            onFocus={() => {
              setOpen(true);
            }}
            onBlur={() => {
              setOpen(false);
            }}
            className="text-muted/80 hover:text-ink"
          >
            <Info size={14} aria-hidden />
          </button>
        )}
      </span>
      <span className="text-right font-num text-sm text-ink">{children}</span>
      {open && info && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1 max-w-[320px] rounded-inner bg-ink px-3 py-2 text-xs leading-relaxed font-normal text-paper shadow-float"
        >
          {info}
        </span>
      )}
    </div>
  );
}

/** A value with its unit in a lighter weight, as in "216,5 kWh/(m²·a)". */
export function ValueUnit({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      {value} <span className="text-ink/80">{unit}</span>
    </>
  );
}
