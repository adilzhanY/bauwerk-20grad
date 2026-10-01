import { useEffect, useRef, useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { floorPlanEdits } from "@/geometry/floorPlanImport";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { readFloorPlan, toPlanImage, useFloorplanAvailable } from "@/lod2/api/floorplan";
import type { FloorPlanReading } from "@/lod2/api/floorplan";
import { AiScan } from "@/components/shared/ai/AiScan";
import { AiButton } from "@/components/shared/ai/AiButton";
import { AiCard } from "@/components/shared/ai/AiCard";
import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { useElapsed } from "@/components/shared/useElapsed";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";

/** Floor plans that come with the repository, named `<Gebäude-ID>-<storey>.png`. */
const SAMPLE_PLANS = import.meta.glob<string>("/lod2/sample-plans/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

function samplePlanFor(buildingId: string): string | null {
  const gid = buildingId.startsWith("lod2-") ? buildingId.slice("lod2-".length) : null;
  if (!gid) return null;
  const key = Object.keys(SAMPLE_PLANS).find((k) => k.startsWith(`/lod2/sample-plans/${gid}-`));
  return key ? (SAMPLE_PLANS[key] ?? null) : null;
}

const xy = (p: [number, number]) => ({ x: p[0], y: p[1] });

/** How long the Applied card stays before it leaves. */
const APPLIED_SHOW_MS = 2600;

/** The reveal of a result: one wall after another, then the doors. */
const WALL_STAGGER_MS = 120;
const DOOR_STAGGER_MS = 70;

/**
 * Reads a floor plan drawing into the active storey's interior walls and doors. The walls
 * are searched only inside the building's outline, which the service fits onto the drawing,
 * so the result arrives in the building's own metres. The user sees it over the drawing
 * before anything changes, and applying it is one undo step.
 */
export function FloorPlanSection() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const applyFloorPlan = useEditorStore((s) => s.applyFloorPlan);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const setPlanView = useEditorStore((s) => s.setPlanView);
  const setFloorPlanImage = useEditorStore((s) => s.setFloorPlanImage);
  const planImage = useEditorStore((s) =>
    s.activeStoreyId ? s.floorPlanImages[s.activeStoreyId] : undefined,
  );
  const available = useFloorplanAvailable();
  const fileInput = useRef<HTMLInputElement>(null);
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

  const storey = building.storeys.find((s) => s.id === activeStoreyId);
  const sample = samplePlanFor(building.id);
  if (!available || !storey) return null;

  const discard = () => {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
  };

  const read = async (plan: Blob) => {
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
    }
  };

  const readSample = async () => {
    if (!sample) return;
    const res = await fetch(sample);
    await read(await res.blob());
  };

  const apply = () => {
    if (!result) return;
    const { walls, doors } = result.reading;
    const edits = floorPlanEdits(
      walls.map((w) => ({ a: xy(w.a), b: xy(w.b), thickness: w.thickness })),
      doors.map((d) => ({ a: xy(d.a), b: xy(d.b) })),
      building.footprint,
      storey.height,
      building.constructions,
    );
    // The plan view of this storey, where the reveal plays as the walls go in.
    setActiveStorey(storey.id);
    setPlanView(true);
    applyFloorPlan(storey.id, edits);
    const rooms = useEditorStore.getState().building.storeys.find((s) => s.id === storey.id);
    setApplied({
      walls: edits.interiorWalls.length,
      doors: edits.doors.length,
      rooms: rooms?.rooms.length ?? 0,
    });
    // The drawing stays with the storey, and with the project once it is saved.
    const [width, height] = result.reading.imageSize;
    setFloorPlanImage(storey.id, { url: result.url, width, height });
    setResult(null);
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
      <div className="flex flex-wrap gap-2">
        <AiButton
          disabled={busy}
          onClick={() => {
            fileInput.current?.click();
          }}
        >
          {t("floorPlan.choose")}
        </AiButton>
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
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={t("floorPlan.choose")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = "";
        }}
      />
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

/**
 * The drawing with the outline, walls and doors the service found, drawn over it. The walls
 * draw themselves in one after another and the doors pop in after them, so the result
 * arrives the way the AI found it.
 */
function PlanPreview({
  reading,
  url,
  label,
}: {
  reading: FloorPlanReading;
  url: string;
  label: string;
}) {
  const footprint = useEditorStore((s) => s.building.footprint);
  const [w, h] = reading.imageSize;
  const at = (p: { x: number; y: number }) => toPlanImage(reading, p);
  const line = (a: [number, number], b: [number, number]) => {
    const p = at(xy(a));
    const q = at(xy(b));
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
  };
  const stroke = Math.max(w, h) / 150;
  return (
    <svg viewBox={`0 0 ${String(w)} ${String(h)}`} role="img" aria-label={label} className="w-full">
      <image href={url} width={w} height={h} />
      <polygon
        points={footprint.map((p) => `${String(at(p).x)},${String(at(p).y)}`).join(" ")}
        fill="none"
        stroke="var(--color-select)"
        strokeWidth={stroke}
        opacity={0.6}
      />
      {reading.walls.map((wall, i) => (
        <line
          key={`w${String(i)}`}
          {...line(wall.a, wall.b)}
          pathLength={1}
          className="ai-draw"
          style={{ animationDelay: `${String(i * WALL_STAGGER_MS)}ms` }}
          stroke="var(--color-select)"
          // As thick as the service measured it, so the band lies on the drawn wall.
          strokeWidth={Math.max(stroke, (wall.thickness ?? 0) * reading.transform.scale)}
          strokeOpacity={wall.thickness ? 0.6 : 1}
          strokeLinecap="round"
        />
      ))}
      {reading.doors.map((door, i) => (
        <line
          key={`d${String(i)}`}
          {...line(door.a, door.b)}
          className="ai-pop"
          style={{
            animationDelay: `${String(reading.walls.length * WALL_STAGGER_MS + i * DOOR_STAGGER_MS)}ms`,
          }}
          stroke="var(--color-mark)"
          strokeWidth={stroke * 1.6}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
