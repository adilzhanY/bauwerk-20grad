import { AlertTriangle, Check, Sparkles } from "lucide-react";
import { cx } from "../cx";

export type AiStatus = "working" | "done" | "failed";

/**
 * The AI's badge: sparkles in a round tinted badge. They breathe while the AI works; when
 * it is done the badge turns green with a tick at its corner, and on failure it shows a
 * warning in the mark colour. Each change pops in, so the switch is seen.
 */
export function AiIcon({ status, className }: { status: AiStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
        status === "working" && "bg-select-soft text-select",
        status === "done" && "bg-ok-soft text-ok",
        status === "failed" && "bg-mark-soft text-mark",
        className,
      )}
    >
      {status === "failed" ? (
        <AlertTriangle key="failed" size={18} className="ai-pop" />
      ) : (
        <Sparkles key={status} size={18} className={status === "working" ? "ai-spark" : "ai-pop"} />
      )}
      {status === "done" && (
        <span className="ai-pop absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ok text-paper">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}
