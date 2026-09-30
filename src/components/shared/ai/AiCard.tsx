import type { ReactNode } from "react";
import { cx } from "../cx";
import { AiBar } from "./AiBar";
import { AiIcon } from "./AiIcon";
import type { AiStatus } from "./AiIcon";

/**
 * The card every AI job on the site is shown in, from start to finish: the AI badge and a
 * title, a line under it (the clock, a result), what the AI is looking at or found, the
 * progress bar while it works, a detail line, and the actions. Put it in a Presence so it
 * arrives and leaves like everything else.
 */
export function AiCard({
  status,
  title,
  meta,
  children,
  detail,
  actions,
  bar = status === "working",
  className,
}: {
  status: AiStatus;
  title: ReactNode;
  /** Under the title: the running clock, the time it took, a short result. */
  meta?: ReactNode;
  /** The picture under AiScan, the steps, the preview of the result. */
  children?: ReactNode;
  /** A sentence under everything: what the AI does, why it failed. */
  detail?: ReactNode;
  actions?: ReactNode;
  /** The progress bar: shown while working by default, green when done. */
  bar?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "flex flex-col gap-3 rounded-card border border-line bg-paper p-4 shadow-float",
        className,
      )}
    >
      <header className="flex items-center gap-3">
        <AiIcon status={status} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {meta !== undefined && (
            <p className="font-num text-xs text-muted" aria-live="off">
              {meta}
            </p>
          )}
        </div>
      </header>
      {children}
      {bar && <AiBar done={status === "done"} />}
      {detail !== undefined && (
        <p
          className={cx(
            "text-xs leading-relaxed",
            status === "failed" ? "text-mark" : "text-muted",
          )}
        >
          {detail}
        </p>
      )}
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
