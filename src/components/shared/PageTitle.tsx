import type { ReactNode } from "react";
import { cx } from "./cx";

/** The heading of a page, with an optional line under it. One size on every page. */
export function PageTitle({
  title,
  subtitle,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <header className={className}>
      <h1 className="text-title leading-tight font-semibold text-ink">{title}</h1>
      {subtitle !== undefined && (
        <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted">{subtitle}</p>
      )}
    </header>
  );
}

/** The small uppercase label over a section: the only uppercase on the site. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={cx(
        "font-num text-[11px] font-medium tracking-[0.12em] text-faint uppercase",
        className,
      )}
    >
      {children}
    </h2>
  );
}
