import { cx } from "../cx";

/** The AI's progress: a light sweeping along a thin track, filled green when it is done. */
export function AiBar({ done = false, className }: { done?: boolean; className?: string }) {
  return (
    <div className={cx("ai-bar", className)} aria-hidden>
      <div className={cx("ai-bar-fill", done && "is-done")} />
    </div>
  );
}
