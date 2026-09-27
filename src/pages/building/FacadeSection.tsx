import { Camera, Sparkles, X } from "lucide-react";
import { wallAzimuth } from "lod2-core/wall";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useVisionAvailable } from "@/lod2/api/useVisionAvailable";
import { useSelectedSurface, wallAboveGround } from "@/lod2/state/selectedWall";
import { useStore } from "@/lod2/state/store";
import { surveyOf, useSurvey } from "@/lod2/state/survey";
import { useEditorStore } from "@/store/building";
import { SectionTitle } from "./sections";

const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] as const;
const COMPASS_EN = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/**
 * The wall picked in the 3D model, with the two ways to survey it: SAM 3 finds its windows
 * from a photo, or they are placed by hand. The building page pins it to the top of its panel
 * while a wall is selected, so the buttons are in reach wherever the page is scrolled.
 */
export function SelectedWallCard() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const surface = useSelectedSurface();
  const vision = useVisionAvailable();
  const openPhotoEditor = useStore((s) => s.openPhotoEditor);
  const openPhotoEditorAuto = useStore((s) => s.openPhotoEditorAuto);
  const selectWall = useStore((s) => s.selectWall);

  const isWall = surface?.kind === "wall";
  const facing = isWall ? wallAzimuth(surface.ring) : null;
  const plane = isWall ? wallAboveGround(surface.ring, surface.terrain).plane : null;
  const compass =
    facing === null ? "" : (language === "de" ? COMPASS : COMPASS_EN)[Math.round(facing / 45) % 8];
  if (!isWall || !plane) return null;

  return (
    <div className="rounded-card border border-line bg-paper p-5 shadow-soft">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[15px] font-medium">
          {t("facade.selected", { n: surface.ref.surfaceIndex })}
          <span className="font-normal text-muted">
            {" "}
            · {compass} ({Math.round(facing ?? 0)}°) · {formatNumber(plane.width, language, 2)} ×{" "}
            {formatNumber(plane.height, language, 2)} m
          </span>
        </p>
        <button
          type="button"
          aria-label={t("facade.deselect")}
          title={t("facade.deselect")}
          onClick={() => {
            selectWall(null);
          }}
          className="-mt-1 -mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-panel hover:text-ink"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="mt-4 flex gap-2">
        {vision && (
          <button
            type="button"
            onClick={openPhotoEditorAuto}
            className="flex h-10 items-center gap-2 rounded-control bg-select px-4 text-sm font-medium text-white hover:bg-select-strong"
          >
            <Sparkles size={16} aria-hidden />
            {t("facade.detect")}
          </button>
        )}
        <button
          type="button"
          onClick={openPhotoEditor}
          className="flex h-10 items-center gap-2 rounded-control border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-panel"
        >
          <Camera size={16} aria-hidden />
          {t("facade.addPhoto")}
        </button>
      </div>
      {vision === false && <p className="mt-3 text-xs text-muted">{t("facade.visionOff")}</p>}
    </div>
  );
}

/**
 * The facade survey on the building page: every photographed wall is listed; walls without a
 * photo count with the default windows of the official rule until they have one. The wall
 * being surveyed sits at the top of the panel (SelectedWallCard); until one is picked this
 * section says how.
 */
export function FacadeSection({ gid, partGid }: { gid: string; partGid: string | null }) {
  const t = useT();
  const surface = useSelectedSurface();
  const survey = useSurvey((s) => surveyOf(s.buildings, gid));
  const removeWall = useSurvey((s) => s.removeWall);
  const walls = Object.entries(survey.walls)
    .filter(([, w]) => w.partGid === partGid)
    .sort((a, b) => a[1].surfaceIndex - b[1].surfaceIndex);
  const isWall = surface?.kind === "wall";

  return (
    <section>
      <SectionTitle>{t("facade.title")}</SectionTitle>
      {!isWall && (
        <p className="rounded-card border border-dashed border-line-strong px-5 py-4 text-sm leading-relaxed text-muted">
          {t("facade.pickWall")}
        </p>
      )}

      {walls.length > 0 ? (
        <ul className="mt-4">
          {walls.map(([key, w]) => (
            <li
              key={key}
              className="flex min-h-[48px] items-center gap-3 border-b border-line text-[15px]"
            >
              <span className="flex-1">
                {t("facade.wall", { n: w.surfaceIndex })}
                <span className="text-muted">
                  {" "}
                  · {t("facade.openings", { n: w.openings.length })}
                  {w.photo ? ` · ${w.photo}` : ""}
                </span>
              </span>
              <button
                type="button"
                aria-label={t("facade.remove", { n: w.surfaceIndex })}
                onClick={() => {
                  removeWall(gid, key);
                }}
                className="text-muted hover:text-ink"
              >
                <X size={15} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs leading-relaxed text-muted">{t("facade.defaultHint")}</p>
      )}
    </section>
  );
}
