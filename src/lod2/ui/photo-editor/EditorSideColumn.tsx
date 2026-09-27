import type { Quad } from "lod2-core/photo";
import { CustomCheckbox } from "@/components/CustomCheckbox";
import { useT } from "@/i18n/useT";
import type { WallPlane } from "lod2-core/wall";
import { CustomSection } from "../../components/CustomField.tsx";
import { CustomSlider } from "../../components/CustomSlider.tsx";
import { cx } from "../../components/cx.ts";
import { DETECTION_LEAVE_MS } from "./constants.ts";
import { DetectionOverlay } from "./DetectionOverlay.tsx";
import { Hint } from "../../components/Hint.tsx";
import { OpeningsList } from "./OpeningsPanels.tsx";
import { RectifiedPreview } from "./RectifiedPreview.tsx";
import type { DetectionState, EditorMode, WallImage, WallView, WorkingPhoto } from "./types.ts";
import type { OpeningsState } from "./useOpenings.ts";
import { usePresence } from "./usePresence.ts";

/** The right-hand column: detection progress, the live preview, the wall image, and the openings list. */
export function EditorSideColumn({
  mode,
  detection,
  onDismissDetection,
  onCancelDetection,
  working,
  corners,
  wall,
  wallImage,
  applyError,
  openings,
  view,
  onView,
  extra,
}: {
  mode: EditorMode;
  detection: DetectionState | null;
  onDismissDetection: () => void;
  onCancelDetection: () => void;
  working: WorkingPhoto | null;
  corners: Quad | null;
  wall: WallPlane | null;
  wallImage: WallImage | null;
  applyError: string | null;
  openings: OpeningsState;
  view: WallView;
  onView: (view: WallView) => void;
  /** More content on the wall step, above the list of openings. */
  extra?: React.ReactNode;
}) {
  const t = useT();
  const progress = usePresence(detection, DETECTION_LEAVE_MS);

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-y-auto rounded-card bg-panel">
      {progress.shown && (
        // Fades and slides in, and on the way out fades while its height folds away, so
        // the sections below move up smoothly instead of jumping.
        <div className={cx("detect-presence", progress.leaving && "is-leaving")}>
          <div className="min-h-0 overflow-hidden">
            <DetectionOverlay
              state={progress.shown}
              onDismiss={onDismissDetection}
              onCancel={onCancelDetection}
            />
          </div>
        </div>
      )}
      {/*
        Only while placing the dots: it is the live check on the corners before Apply. In
        the openings editor the full rectified wall is already in the middle, so repeating
        it here would only push the openings list down.
      */}
      {mode === "photo" && (
        <CustomSection title={t("photo.preview")} first>
          <RectifiedPreview working={working} corners={corners} wall={wall} />
        </CustomSection>
      )}
      <CustomSection title={t("photo.rectifiedWall")} first={mode === "wall"}>
        {applyError && <Hint error>{applyError}</Hint>}
        {wallImage ? (
          <Hint>
            {t("photo.wallPixels", { width: wallImage.width, height: wallImage.height })}{" "}
            {mode === "photo" ? t("photo.applyToDraw") : t("photo.dragToDraw")}
          </Hint>
        ) : (
          !applyError && <Hint>{t("photo.applyToBuild")}</Hint>
        )}
        {mode === "wall" && <Hint>{t("photo.editHint")}</Hint>}
        {mode === "wall" && wallImage && (
          <>
            <div className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-xs font-medium text-muted select-none">
                {t("photo.imageTransparency")}
              </span>
              <CustomSlider
                label={t("photo.imageTransparency")}
                value={view.transparency}
                min={0}
                max={100}
                step={5}
                onChange={(transparency) => {
                  onView({ ...view, transparency });
                }}
                format={(v) => `${v} %`}
              />
              <span className="w-10 shrink-0 text-right font-num text-xs text-ink">
                {view.transparency} %
              </span>
            </div>
            <CustomCheckbox
              variant="switch"
              label={t("photo.showSizes")}
              checked={view.showSizes}
              onChange={(showSizes) => {
                onView({ ...view, showSizes });
              }}
            />
          </>
        )}
      </CustomSection>
      {mode === "wall" && extra}
      {wall && (
        <OpeningsList
          openings={openings.list}
          selected={openings.selected}
          summary={openings.summary}
          onSelect={openings.select}
        />
      )}
    </aside>
  );
}
