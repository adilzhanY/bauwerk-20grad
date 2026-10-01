import { Hint } from "@/components/shared/Hint";
import { useEffect, useMemo, useRef } from "react";
import { hasWebGL } from "@/lib/webgl";
import { WebGLMissing } from "@/components/app/States";
import { Viewport } from "@/scene/Viewport";
import type { RenderSample } from "@/scene/FrameProbe";
import { benchBuilding, frameStats } from "@/lib/bench";
import { formatNumber } from "@/lib/format";
import { useT } from "@/i18n/useT";
import { startNewProject } from "@/projects/session";
import { useEditorStore } from "@/store/building";

/**
 * The benchmark page: the fifty storey tower in the viewport and, over it, a
 * frame time graph for the last ten seconds with the renderer counters. Orbit
 * the model while watching the numbers; they are what the README asks for.
 */
export function BenchPage({
  sample,
  onSample,
}: {
  sample: RenderSample | null;
  onSample: (s: RenderSample) => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const loaded = useRef(false);
  const webgl = useMemo(() => hasWebGL(), []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    // Its own unsaved project: an open project is left, never overwritten.
    void startNewProject(benchBuilding(language));
  }, [language]);

  const stats = frameStats(sample?.frameTimesMs ?? []);
  const num = (v: number, d = 1) => formatNumber(v, language, d);
  const w = 360;
  const h = 80;
  const times = sample?.frameTimesMs ?? [];
  const maxT = Math.max(33, ...times);
  const path = times
    .map((v, i) => `${(i / Math.max(1, times.length - 1)) * w},${h - (v / maxT) * h}`)
    .join(" ");

  return (
    <div className="relative h-full bg-paper">
      <main className="absolute inset-0">
        {webgl ? <Viewport onSample={onSample} /> : <WebGLMissing />}
      </main>
      <aside className="pointer-events-none absolute top-4 left-4 flex w-[400px] flex-col gap-3 rounded-card border border-line bg-panel/95 p-4 shadow-float">
        <h1 className="font-display text-lg font-semibold text-ink">{t("bench.title")}</h1>
        <Hint>{t("bench.subtitle")}</Hint>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t("bench.graph")}>
          <line
            x1="0"
            y1={h - (16.7 / maxT) * h}
            x2={w}
            y2={h - (16.7 / maxT) * h}
            stroke="var(--ok)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          <line
            x1="0"
            y1={h - (33.3 / maxT) * h}
            x2={w}
            y2={h - (33.3 / maxT) * h}
            stroke="var(--mark)"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          {times.length > 1 && (
            <polyline points={path} fill="none" stroke="var(--select)" strokeWidth="1.5" />
          )}
        </svg>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Row k={t("bench.fps")} v={num(stats.fps, 0)} />
          <Row k={t("bench.mean")} v={`${num(stats.mean)} ms`} />
          <Row k={t("bench.p95")} v={`${num(stats.p95)} ms`} />
          <Row k={t("bench.max")} v={`${num(stats.max)} ms`} />
          <Row k={t("bench.calls")} v={num(sample?.calls ?? 0, 0)} />
          <Row k={t("bench.triangles")} v={num(sample?.triangles ?? 0, 0)} />
          <Row k={t("bench.geometries")} v={num(sample?.geometries ?? 0, 0)} />
          <Row k={t("bench.textures")} v={num(sample?.textures ?? 0, 0)} />
        </dl>
        <Hint>{t("bench.strategy")}</Hint>
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-num text-ink">{v}</dd>
    </>
  );
}
