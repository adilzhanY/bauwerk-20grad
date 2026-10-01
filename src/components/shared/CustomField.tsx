import { Hint } from "@/components/shared/Hint";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "@/components/shared/cx";
import { Presence } from "./Presence";
import { SectionLabel } from "./PageTitle";
import { noteId } from "./noteId";

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
        <Hint error id={htmlFor && noteId(htmlFor)}>
          {error}
        </Hint>
      ) : hint ? (
        <Hint id={htmlFor && noteId(htmlFor)}>{hint}</Hint>
      ) : null}
    </div>
  );
}

/**
 * A visible label over a control that is not a single input (a segmented choice, a set of
 * buttons), announced as the group's name. For one input use CustomField.
 */
export function CustomFieldGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1">
      <span id={id} className="text-xs font-medium text-muted select-none">
        {label}
      </span>
      {children}
    </div>
  );
}

interface SectionProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  /** Draws the section without the top rule, for the first one in a panel. */
  first?: boolean;
  /** The title opens and closes the section; it starts closed unless `defaultOpen`. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

/** A titled block in a side panel. The title is an h2 so panels read as an outline. */
export function CustomSection({
  title,
  action,
  children,
  first = false,
  collapsible = false,
  defaultOpen = false,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={cx(
        "flex flex-col px-4 pt-4",
        collapsible && !open ? "pb-4" : "gap-3.5 pb-5",
        !first && "border-t border-line",
      )}
    >
      <header className="flex h-7 items-center justify-between">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
            className="-ml-1 flex h-7 flex-1 items-center gap-1 text-faint hover:text-ink"
          >
            <ChevronRight
              size={13}
              aria-hidden
              className={cx("transition-transform", open && "rotate-90")}
            />
            <SectionLabel>{title}</SectionLabel>
          </button>
        ) : (
          <SectionLabel>{title}</SectionLabel>
        )}
        {action}
      </header>
      {collapsible ? (
        <Presence show={open} className="flex flex-col gap-3.5">
          {children}
        </Presence>
      ) : (
        children
      )}
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
