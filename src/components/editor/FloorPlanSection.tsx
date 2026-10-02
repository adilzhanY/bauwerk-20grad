import { useEffect, useState } from "react";
import { FileText, LayoutGrid, X } from "lucide-react";
import { isPdf } from "@/lib/pdfPages";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { errorText } from "@/lod2/api/errors";
import { readFloorPlan, useFloorplanAvailable } from "@/lod2/api/floorplan";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { AiScan } from "@/components/shared/ai/AiScan";
import { AiCard } from "@/components/shared/ai/AiCard";
import { Card } from "@/components/shared/Card";
import { DropZone } from "@/components/shared/DropZone";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { useElapsed } from "@/components/shared/useElapsed";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { applyReading } from "./applyReading";
import { PlanPreview } from "./PlanPreview";
import { samplePdfFor, samplePlanFor } from "./samplePlans";

/** How long the Applied card stays before it leaves. */
const APPLIED_SHOW_MS = 2600;

/**
 * Reads a floor plan drawing into the active storey's interior walls and doors. The walls
 * are searched only inside the building's outline, which the service fits onto the drawing,
 * so the result arrives in the building's own metres. The user sees it over the drawing
 * before anything changes, and applying it is one undo step.
 */
export function FloorPlanSection({
  onApplied,
  onPdf,
}: {
  /** Called once a reading is applied, so a dialog around it can close on the reveal. */
  onApplied?: () => void;
  /** A PDF was picked: its pages go to the storeys in the PDF import. */
  onPdf?: (file: File) => void;
} = {}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const setPlanView = useEditorStore((s) => s.setPlanView);
  const planImage = useEditorStore((s) =>
    s.activeStoreyId ? s.floorPlanImages[s.activeStoreyId] : undefined,
  );
  const available = useFloorplanAvailable();
  /** The plan the AI is reading right now, shown under the scan while it works. */
  const [job, setJob] = useState<{ url: string; startedAt: number; ahead: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    reading: FloorPlanReading;
    url: string;
    seconds: number;
  } | null>(null);
  const busy = job !== null;
  /** What was just applied, shown for a moment; the card then leaves by itself. */
  const [applied, setApplied] = useState<{ walls: number; doors: number; rooms: number } | null>(
    null,
  );

  useEffect(() => {
    if (!applied) return;
    const timer = setTimeout(() => {
      setApplied(null);
    }, APPLIED_SHOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [applied]);

  const storeyIndex = building.storeys.findIndex((s) => s.id === activeStoreyId);
  const storey = building.storeys[storeyIndex];
  const sample = samplePlanFor(building, storeyIndex);
  const samplePdf = onPdf ? samplePdfFor(building) : null;
  if (!available || !storey) return null;

  function discard() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  }

  async function read(plan: Blob) {
    setError(null);
    discard();
    const url = URL.createObjectURL(plan);
    const startedAt = performance.now();
    setJob({ url, startedAt, ahead: 0 });
    try {
      const reading = await readFloorPlan(plan, building.footprint, undefined, (ahead) => {
        setJob((current) => current && { ...current, ahead });
      });
      setResult({ reading, url, seconds: (performance.now() - startedAt) / 1000 });
    } catch (e) {
      URL.revokeObjectURL(url);
      setError(errorText(e, t));
    } finally {
      setJob(null);
    }
  }

  const readSample = async () => {
    if (!sample) return;
    try {
      const res = await fetch(sample);
      if (!res.ok) throw new Error(t("floorPlan.sampleFailed"));
      await read(await res.blob());
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  const openSamplePdf = async () => {
    if (!samplePdf || !onPdf) return;
    try {
      const res = await fetch(samplePdf);
      if (!res.ok) throw new Error(t("floorPlan.sampleFailed"));
      const name = samplePdf.split("/").pop() ?? "plans.pdf";
      onPdf(new File([await res.blob()], name, { type: "application/pdf" }));
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  const apply = () => {
    if (!result) return;
    // The plan view of this storey, where the reveal plays as the walls go in. The drawing
    // stays with the storey, and with the project once it is saved.
    setActiveStorey(storey.id);
    setPlanView(true);
    setApplied(applyReading(storey.id, result.reading, result.url));
    setResult(null);
    onApplied?.();
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <Hint>{t("floorPlan.hint")}</Hint>
      <Presence value={job || result ? null : (planImage ?? null)}>
        {(image) => (
          <Card inset className="flex flex-col gap-2 p-2">
            <img
              src={image.url}
              alt={t("floorPlan.saved", { storey: storey.name })}
              className="block w-full rounded-soft"
            />
            <Hint>{t("floorPlan.saved", { storey: storey.name })}</Hint>
          </Card>
        )}
      </Presence>
      {/* Dragged in, chosen or pasted (a screenshot, a scan open in another app): the AI reads it. */}
      <Presence show={!job && !result}>
        <DropZone
          accept={onPdf ? "image/*,application/pdf,.pdf" : "image/*"}
          label={t(onPdf ? "floorPlan.dropOrPdf" : "floorPlan.drop")}
          disabled={busy}
          onFiles={(files) => {
            const file = files[0];
            if (file && onPdf && isPdf(file)) onPdf(file);
            else if (file) void read(file);
          }}
        />
      </Presence>
      <div className="flex flex-wrap gap-2">
        {sample && (
          <CustomButton
            variant="quiet"
            icon={<LayoutGrid size={14} />}
            disabled={busy}
            onClick={() => {
              void readSample();
            }}
          >
            {t("floorPlan.sample")}
          </CustomButton>
        )}
        {samplePdf && (
          <CustomButton
            variant="quiet"
            icon={<FileText size={14} />}
            disabled={busy}
            onClick={() => {
              void openSamplePdf();
            }}
          >
            {t("floorPlan.samplePdf")}
          </CustomButton>
        )}
      </div>
      <Presence value={job}>
        {(j) => <Reading url={j.url} startedAt={j.startedAt} ahead={j.ahead} />}
      </Presence>
      <Presence value={error}>
        {(message) => (
          <AiCard
            status="failed"
            title={t("floorPlan.failed")}
            detail={message}
            actions={
              <CustomButton
                variant="quiet"
                icon={<X size={14} />}
                onClick={() => {
                  setError(null);
                }}
              >
                {t("photo.close")}
              </CustomButton>
            }
          />
        )}
      </Presence>
      <Presence value={applied}>
        {(done) => (
          <AiCard
            status="done"
            title={t("floorPlan.applied")}
            meta={t("floorPlan.appliedDetail", done)}
            bar={false}
          />
        )}
      </Presence>
      <Presence value={result}>
        {(r) => (
          <AiCard
            status="done"
            title={t("floorPlan.found", {
              walls: r.reading.walls.length,
              doors: r.reading.doors.length,
            })}
            meta={t("photo.detect.doneIn", { seconds: formatNumber(r.seconds, language, 1) })}
            bar={false}
            detail={
              <>
                {t("floorPlan.fit", { cm: formatNumber(r.reading.fitError * 100, language, 1) })}{" "}
                {r.reading.roomModel ? t("floorPlan.withModel") : t("floorPlan.withoutModel")}
              </>
            }
            actions={
              <>
                <CustomButton variant="primary" onClick={apply}>
                  {t("floorPlan.apply", { storey: storey.name })}
                </CustomButton>
                <CustomButton variant="quiet" icon={<X size={14} />} onClick={discard}>
                  {t("floorPlan.discard")}
                </CustomButton>
              </>
            }
          >
            <PlanPreview reading={r.reading} url={r.url} label={t("floorPlan.preview")} />
          </AiCard>
        )}
      </Presence>
    </div>
  );
}

/**
 * While the AI reads the plan: the plan itself under the AI scan, the working badge, a
 * clock, and what it is doing, or how many jobs of other people the AI does first. The service
 * answers once, at the end, so no step is ticked off that has not really finished.
 */
function Reading({ url, startedAt, ahead }: { url: string; startedAt: number; ahead: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const seconds = useElapsed(startedAt, undefined);
  return (
    <AiCard
      status="working"
      title={t(ahead > 0 ? "ai.queue.title" : "floorPlan.aiTitle")}
      meta={`${formatNumber(seconds, language, 1)} s`}
      detail={
        ahead > 0
          ? t(ahead === 1 ? "ai.queue.one" : "ai.queue.many", { n: ahead })
          : t("floorPlan.aiDetail")
      }
    >
      <div className="relative overflow-hidden rounded-inner">
        <img src={url} alt="" className="block w-full" />
        <AiScan />
      </div>
    </AiCard>
  );
}
