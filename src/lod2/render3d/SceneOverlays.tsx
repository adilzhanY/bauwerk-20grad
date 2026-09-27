import { useEditorStore } from "@/store/building";
import { useT } from "@/i18n/useT";
import { useStore, wallKey } from "../state/store.ts";
import { useSurvey } from "../state/survey.ts";
import { useFormat } from "../ui/format.ts";
import { wallAzimuth } from "lod2-core/wall";
import { Spinner } from "../components/CustomButton.tsx";
import { useSelectedSurface, wallAboveGround } from "../state/selectedWall.ts";

/** Bottom-right of the 3D view: which wall is selected, where it faces, how big it is. */
export function SelectedWallCaption() {
  const format = useFormat();
  const t = useT();
  const surface = useSelectedSurface();
  const buildingGid = useStore((s) => s.building?.buildingGid ?? null);
  const surveyed = useSurvey((s) => {
    if (!surface || !buildingGid) return null;
    return s.buildings[buildingGid]?.walls[wallKey(surface.ref)]?.openings.length ?? null;
  });
  if (surface?.kind !== "wall") return null;
  const azimuth = wallAzimuth(surface.ring);
  const { plane } = wallAboveGround(surface.ring, surface.terrain);
  const size = plane ? format.size(plane.width, plane.height) : "";
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 rounded-soft border border-line bg-panel/90 px-2.5 py-1 font-num text-xs text-muted">
      {t("lod2.caption.wall", { index: surface.ref.surfaceIndex })}
      {azimuth !== null && <> · {t("lod2.caption.faces", { degrees: Math.round(azimuth) })}</>}
      {size && <> · {size}</>}
      {surveyed !== null && (
        <span className="text-ok"> · {t("lod2.caption.surveyed", { count: surveyed })}</span>
      )}
    </div>
  );
}

/**
 * What the scene is still working on, over the top of whatever is already drawn.
 *
 * Worth being specific rather than showing a generic spinner, because the three waits have
 * very different lengths and only one of them is avoidable by waiting less. The building
 * itself arrives in well under a second; its surroundings are eight megabytes and twenty
 * thousand surfaces to triangulate; the terrain is interpolated from every contact line in
 * view. Naming the step is the difference between "this is slow" and "this is broken".
 */
export function SceneProgress({
  context,
  imagery,
  neighbourCount,
}: {
  context: boolean;
  imagery: boolean;
  neighbourCount: number;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  if (!context && !imagery) return null;

  const label = context
    ? neighbourCount
      ? t("lod2.placingContext", {
          count: neighbourCount.toLocaleString(language === "de" ? "de-DE" : "en-GB"),
        })
      : t("lod2.loadingSurroundings")
    : t("lod2.loadingImagery");

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-3 left-3 flex max-w-[min(340px,calc(100%-24px))] items-start gap-2.5 rounded-inner border border-line bg-panel/95 px-3 py-2.5 text-xs leading-snug text-ink shadow-float backdrop-blur-sm"
    >
      <span className="mt-0.5 text-muted">
        <Spinner />
      </span>
      <span>
        {label}
        {context && (
          <>
            <br />
            <span className="text-muted">{t("lod2.contextNote")}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** A centred line of text in place of the canvas, for the states with nothing to draw. */
export function SceneMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 bg-panel p-6 text-center text-sm text-muted">
      {children}
    </div>
  );
}
