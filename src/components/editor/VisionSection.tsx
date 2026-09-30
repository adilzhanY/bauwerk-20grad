import { useEffect, useState } from "react";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { useVision } from "@/vision/useVision";
import { CustomButton } from "@/components/shared/CustomButton";
import { AiButton } from "@/components/shared/ai/AiButton";
import { AiCard } from "@/components/shared/ai/AiCard";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";

/** Runs the vision pipeline on the underlay and lets the user review and accept the proposal. */
export function VisionSection() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const underlay = useEditorStore((s) => s.underlay);
  const proposal = useEditorStore((s) => s.proposal);
  const setProposal = useEditorStore((s) => s.setProposal);
  const toggleProposalWall = useEditorStore((s) => s.toggleProposalWall);
  const acceptProposal = useEditorStore((s) => s.acceptProposal);
  const { state, run, reset } = useVision();
  const [minConfidence, setMinConfidence] = useState(0.6);

  // Move the worker result into the store once it arrives.
  useEffect(() => {
    if (state.status !== "done" || !state.proposal || proposal) return;
    setProposal({
      footprint: state.proposal.footprint,
      interiorWalls: state.proposal.interiorWalls.map((w) => ({ ...w, enabled: true })),
    });
  }, [proposal, setProposal, state.proposal, state.status]);

  if (!underlay) return null;
  const running = state.status === "loading" || state.status === "running";

  const detect = () => {
    void run(
      underlay.url,
      { x: underlay.x, y: underlay.y, widthMetres: underlay.widthMetres },
      minConfidence,
    ).then(() => undefined);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <Hint>{t("vision.hint")}</Hint>
      <CustomNumberInput
        label={t("vision.confidence")}
        value={minConfidence}
        min={0.2}
        max={1}
        step={0.05}
        language={language}
        onChange={setMinConfidence}
      />
      <AiButton disabled={running} onClick={detect} className="self-start">
        {t("vision.detect")}
      </AiButton>
      <Presence show={running}>
        <AiCard
          status="working"
          title={t("vision.running")}
          meta={t(`vision.step.${state.step || "image"}` as MessageKey)}
        />
      </Presence>
      <Presence
        value={
          state.status === "error"
            ? state.error
            : state.status === "done" && !state.proposal
              ? t("vision.none")
              : null
        }
      >
        {(message) => <AiCard status="failed" title={t("vision.failed")} detail={message} />}
      </Presence>
      <Presence value={proposal}>
        {(p) => (
          <AiCard
            status="done"
            title={t("vision.found", {
              corners: p.footprint.length,
              walls: p.interiorWalls.length,
              skew: formatNumber(state.proposal?.skewDegrees ?? 0, language, 1),
            })}
            bar={false}
            actions={
              <>
                <CustomButton
                  variant="primary"
                  onClick={() => {
                    acceptProposal();
                    reset();
                  }}
                >
                  {t("vision.accept")}
                </CustomButton>
                <CustomButton
                  variant="quiet"
                  onClick={() => {
                    setProposal(null);
                    reset();
                  }}
                >
                  {t("vision.discard")}
                </CustomButton>
              </>
            }
          >
            <ul className="flex flex-col gap-1">
              {p.interiorWalls.map((w, i) => (
                <li key={i}>
                  <CustomCheckbox
                    label={`${t("vision.wall", { n: i + 1 })} · ${formatNumber(w.confidence * 100, language, 0)} %`}
                    checked={w.enabled}
                    onChange={() => {
                      toggleProposalWall(i);
                    }}
                  />
                </li>
              ))}
            </ul>
          </AiCard>
        )}
      </Presence>
    </div>
  );
}
