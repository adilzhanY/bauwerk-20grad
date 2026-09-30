import type { ReactNode } from "react";
import { cx } from "./cx";

export type NoticeTone = "info" | "warning" | "ok" | "neutral";

const TONES: Record<NoticeTone, string> = {
  info: "border-select-soft bg-select-soft text-select",
  warning: "border-mark bg-mark-soft text-mark",
  ok: "border-ok-soft bg-ok-soft text-ok",
  neutral: "border-line bg-panel text-muted",
};

/**
 * A boxed message in a tone: information, a warning (announced as an alert), a success, or a
 * neutral remark. For a one-line hint under a control use Hint; for a message floating over
 * the page use Toast.
 */
export function Notice({
  tone = "info",
  className,
  children,
}: {
  tone?: NoticeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : undefined}
      className={cx(
        "rounded-inner border px-3 py-2 text-xs leading-relaxed",
        TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
