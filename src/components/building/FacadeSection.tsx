import { Presence } from "@/components/shared/Presence";
import { aiOffText } from "@/lib/aiHost";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Card } from "@/components/shared/Card";
import { Camera, X } from "lucide-react";
import { AiButton } from "@/components/shared/ai/AiButton";
import { CustomButton } from "@/components/shared/CustomButton";
import { Hint } from "@/components/shared/Hint";
import { wallAzimuth } from "lod2-core/wall";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useVisionAvailable } from "@/lod2/api/useVisionAvailable";
import { useSelectedSurface, wallAboveGround } from "@/lod2/state/selectedWall";
import { useStore } from "@/lod2/state/store";
import { surveyOf, useSurvey } from "@/lod2/state/survey";
import { useEditorStore } from "@/store/building";
import { SectionTitle } from "@/components/building/sections";

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
  const selectWall = useStore((s) => s.selectWall);

  const isWall = surface?.kind === "wall";
  const facing = isWall ? wallAzimuth(surface.ring) : null;
  const plane = isWall ? wallAboveGround(surface.ring, surface.terrain).plane : null;
  const compass =
    facing === null ? "" : (language === "de" ? COMPASS : COMPASS_EN)[Math.round(facing / 45) % 8];
  if (!isWall || !plane) return null;

  return (
    <Card elevation="raised" className="p-5">
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[15px] font-medium">
          {t("facade.selected", { n: surface.ref.surfaceIndex })}
          <span className="font-normal text-muted">
            {" "}
            · {compass} ({Math.round(facing ?? 0)}°) · {formatNumber(plane.width, language, 2)} ×{" "}
            {formatNumber(plane.height, language, 2)} m
          </span>
        </p>
        <CustomIconButton
          label={t("facade.deselect")}
          size="sm"
          className="-mt-1 -mr-2"
          onClick={() => {
            selectWall(null);
          }}
        >
          <X size={15} aria-hidden />
        </CustomIconButton>
      </div>
      <div className="mt-4 flex gap-2">
        {/* One way in: the editor opens with Choose photo, the samples and paste. With SAM 3
            running any photo is detected at once, so the button says so. */}
        {vision ? (
          <AiButton onClick={openPhotoEditor}>{t("facade.detect")}</AiButton>
        ) : (
          <CustomButton icon={<Camera size={15} aria-hidden />} onClick={openPhotoEditor}>
            {t("facade.addPhoto")}
          </CustomButton>
        )}
      </div>
      <Presence show={vision === false}>
        <Hint className="mt-3">{aiOffText(t)}</Hint>
      </Presence>
    </Card>
  );
}

/**
 * The facade survey on the building page: every photographed wall is listed; walls without a
 * photo count as closed walls until a photo shows their openings. The wall
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
      <Presence show={!isWall}>
        <p className="rounded-card border border-dashed border-line-strong px-5 py-4 text-sm leading-relaxed text-muted">
          {t("facade.pickWall")}
        </p>
      </Presence>

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
              <CustomIconButton
                label={t("facade.remove", { n: w.surfaceIndex })}
                size="xs"
                onClick={() => {
                  removeWall(gid, key);
                }}
              >
                <X size={15} aria-hidden />
              </CustomIconButton>
            </li>
          ))}
        </ul>
      ) : (
        <Hint className="mt-4">{t("facade.defaultHint")}</Hint>
      )}
    </section>
  );
}
