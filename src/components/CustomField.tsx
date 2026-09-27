import type { ReactNode } from "react";
import { cx } from "./cx";

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Renders the label as a scrub handle (used by the number input). */
  labelProps?: React.LabelHTMLAttributes<HTMLLabelElement>;
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
  /** Draws the section without the top rule, for the first one in a panel. */
  first?: boolean;
}

/** A titled block in a side panel. The title is an h2 so panels read as an outline. */
export function CustomSection({ title, action, children, first = false }: SectionProps) {
  return (
    <section
      className={cx("flex flex-col gap-3.5 px-4 pt-4 pb-5", !first && "border-t border-line")}
    >
      <header className="flex h-7 items-center justify-between">
        <h2 className="font-num text-[11px] font-medium tracking-[0.12em] text-faint uppercase">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Label on the left, mono value on the right. */
export function CustomReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3.5 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right font-num text-sm text-ink">{value}</span>
    </div>
  );
}
