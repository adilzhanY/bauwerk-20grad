import { useEffect, useState } from "react";
import { AlertTriangle, Check, Sparkles, X } from "lucide-react";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { CustomButton } from "../../components/CustomButton.tsx";
import { cx } from "../../components/cx.ts";
import type { DetectionStage, DetectionState } from "./types.ts";
import { useFormat } from "../format.ts";

const STEPS: { key: DetectionStage; title: MessageKey; detail: MessageKey }[] = [
  { key: "corners", title: "photo.detect.cornersTitle", detail: "photo.detect.cornersDetail" },
  { key: "rectify", title: "photo.detect.rectifyTitle", detail: "photo.detect.rectifyDetail" },
  { key: "openings", title: "photo.detect.openingsTitle", detail: "photo.detect.openingsDetail" },
];

const ORDER: DetectionStage[] = ["corners", "rectify", "openings", "done"];

/**
 * Card at the top of the side column while lod2-vision works, so the picture in the middle
 * stays in view and changes as the stages complete. It names the current step, shows the
 * ones already done, and stays for a moment on "done" so the ticks are seen.
 */
export function DetectionOverlay({
  state,
  onDismiss,
  onCancel,
}: {
  state: DetectionState;
  onDismiss: () => void;
  onCancel: () => void;
}) {
  const format = useFormat();
  const t = useT();
  const elapsed = useElapsed(state.startedAt, state.endedAt);
  const seconds = format.num(elapsed, 1);
  const failed = state.stage === "failed";
  const done = state.stage === "done";
  const current = ORDER.indexOf(failed ? (state.failedAt ?? "corners") : state.stage);

  return (
    <div className="shrink-0 px-4 pt-4 pb-2" role="status" aria-live="polite">
      <div className="detect-card rounded-card border border-line bg-paper p-5 shadow-float">
        <header className="flex items-center gap-3">
          <span
            className={cx(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              failed
                ? "bg-mark-soft text-mark"
                : done
                  ? "bg-ok-soft text-ok"
                  : "bg-select-soft text-select",
            )}
          >
            {failed ? (
              <AlertTriangle size={18} aria-hidden />
            ) : done ? (
              <Check size={18} aria-hidden />
            ) : (
              <Sparkles size={18} aria-hidden className="detect-spark" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold tracking-tight text-ink">
              {t(
                failed
                  ? "photo.detect.stopped"
                  : done
                    ? "photo.detect.ready"
                    : "photo.detect.running",
              )}
            </h3>
            <p className="font-num text-xs text-muted" aria-live="off">
              {done
                ? t("photo.detect.doneIn", { seconds })
                : failed
                  ? t("photo.detect.stoppedAfter", { seconds })
                  : `${seconds} s`}
            </p>
          </div>
        </header>

        {!failed && (
          <div className="detect-bar mt-5" aria-hidden>
            <div className={cx("detect-bar-fill", done && "is-done")} />
          </div>
        )}

        <ol className="mt-5 flex flex-col gap-3">
          {STEPS.map((step, index) => {
            const status =
              failed && index === current
                ? "failed"
                : index < current
                  ? "done"
                  : index === current
                    ? "active"
                    : "pending";
            return (
              <li key={step.key} className="flex gap-3">
                <StepMark status={status} />
                <div className="min-w-0">
                  <p
                    className={cx(
                      "text-sm font-medium",
                      status === "pending" ? "text-muted" : "text-ink",
                    )}
                  >
                    {t(step.title)}
                  </p>
                  {status === "active" && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(step.detail)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {!failed && !done && (
          <CustomButton
            variant="quiet"
            icon={<X size={15} aria-hidden />}
            onClick={onCancel}
            className="mt-5"
          >
            {t("photo.detect.stop")}
          </CustomButton>
        )}
        {failed && (
          <div className="mt-5 flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-mark">{state.message}</p>
            <p className="text-xs leading-relaxed text-muted">{t("photo.detect.keepAsIs")}</p>
            <CustomButton
              icon={<X size={15} aria-hidden />}
              onClick={onDismiss}
              className="self-start"
            >
              {t("photo.close")}
            </CustomButton>
          </div>
        )}
      </div>
    </div>
  );
}

function StepMark({ status }: { status: "done" | "active" | "pending" | "failed" }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok text-paper">
        <Check size={12} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return <span className="detect-ring mt-0.5 h-5 w-5 shrink-0 rounded-full" aria-hidden />;
  }
  if (status === "failed") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mark text-paper">
        <X size={12} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  return (
    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-line-strong" aria-hidden />
  );
}

/**
 * Seconds the job has been running, redrawn ten times a second while it runs. Once it has
 * ended, the exact total from `endedAt`.
 */
function useElapsed(startedAt: number, endedAt: number | undefined): number {
  const [now, setNow] = useState(() => performance.now());
  const running = endedAt === undefined;
  useEffect(() => {
    // Until the first tick `now` may predate `startedAt`; the clamp below shows 0 then.
    if (!running) return;
    const timer = setInterval(() => {
      setNow(performance.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [running, startedAt]);
  return Math.max(0, ((endedAt ?? now) - startedAt) / 1000);
}
