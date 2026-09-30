import { Hint } from "@/components/shared/Hint";
import { Check, X } from "lucide-react";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { CustomButton } from "@/components/shared/CustomButton";
import { cx } from "@/components/shared/cx";
import { AiCard } from "@/components/shared/ai/AiCard";
import { Presence } from "@/components/shared/Presence";
import { Spinner } from "@/components/shared/Spinner";
import type { DetectionStage, DetectionState } from "@/components/photo-editor/types";
import { useFormat } from "@/lod2/format";
import { useElapsed } from "@/components/shared/useElapsed";

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
    <div className="shrink-0 px-4 pt-4 pb-2">
      <AiCard
        status={failed ? "failed" : done ? "done" : "working"}
        title={t(
          failed ? "photo.detect.stopped" : done ? "photo.detect.ready" : "photo.detect.running",
        )}
        meta={
          done
            ? t("photo.detect.doneIn", { seconds })
            : failed
              ? t("photo.detect.stoppedAfter", { seconds })
              : `${seconds} s`
        }
        bar={!failed}
        detail={
          failed ? (
            <>
              {state.message} {t("photo.detect.keepAsIs")}
            </>
          ) : undefined
        }
        actions={
          failed ? (
            <CustomButton icon={<X size={15} aria-hidden />} onClick={onDismiss}>
              {t("photo.close")}
            </CustomButton>
          ) : !done ? (
            <CustomButton variant="quiet" icon={<X size={15} aria-hidden />} onClick={onCancel}>
              {t("photo.detect.stop")}
            </CustomButton>
          ) : undefined
        }
      >
        <ol className="flex flex-col gap-3">
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
                  <Presence show={status === "active"}>
                    <Hint className="mt-0.5">{t(step.detail)}</Hint>
                  </Presence>
                </div>
              </li>
            );
          })}
        </ol>
      </AiCard>
    </div>
  );
}

function StepMark({ status }: { status: "done" | "active" | "pending" | "failed" }) {
  if (status === "done") {
    return (
      <span className="ai-pop mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok text-paper">
        <Check size={12} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (status === "active") {
    return <Spinner size="md" className="mt-0.5 text-select" />;
  }
  if (status === "failed") {
    return (
      <span className="ai-pop mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mark text-paper">
        <X size={12} strokeWidth={3} aria-hidden />
      </span>
    );
  }
  return (
    <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-line-strong" aria-hidden />
  );
}
