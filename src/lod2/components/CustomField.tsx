import type { LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Renders the label as a scrub handle (used by the number input). */
  labelProps?: LabelHTMLAttributes<HTMLLabelElement>;
  children: ReactNode;
}

/** Label above a control, with an optional hint or error line below. */
export function CustomField({ label, htmlFor, hint, error, labelProps, children }: FieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        htmlFor={htmlFor}
        {...labelProps}
        className={cx("text-xs font-medium text-muted select-none", labelProps?.className)}
      >
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-mark">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface SectionProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** A little more room above, for the first section in a panel. */
  first?: boolean;
}

/** A titled block in a side panel. The title is an h2 so panels read as an outline. */
export function CustomSection({ title, action, children, first = false }: SectionProps) {
  return (
    <section className={cx("flex flex-col gap-3 px-5 pb-5", first ? "pt-4" : "pt-2")}>
      <header className="flex h-9 items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Label on the left, value on the right. */
export function CustomReadOnly({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right font-num text-sm text-ink">{value}</span>
    </div>
  );
}
