import type { Quad } from "lod2-core/photo";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { useT } from "@/i18n/useT";
import type { WallPlane } from "lod2-core/wall";
import { CustomSection } from "@/components/shared/CustomField";
import { CustomSlider } from "@/components/shared/CustomSlider";
import {} from "@/components/photo-editor/constants";
import { DetectionOverlay } from "@/components/photo-editor/DetectionOverlay";
import { Hint } from "@/components/shared/Hint";
import { OpeningsList } from "@/components/photo-editor/OpeningsPanels";
import { RectifiedPreview } from "@/components/photo-editor/RectifiedPreview";
import type {
  DetectionState,
  EditorMode,
  WallImage,
  WallView,
  WorkingPhoto,
} from "@/components/photo-editor/types";
import type { OpeningsState } from "@/components/photo-editor/useOpenings";
import { Presence } from "@/components/shared/Presence";

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

  return (
    <aside className="flex w-[420px] shrink-0 flex-col overflow-y-auto rounded-card bg-panel">
      <Presence value={detection}>
        {(state) => (
          <DetectionOverlay
            state={state}
            onDismiss={onDismissDetection}
            onCancel={onCancelDetection}
          />
        )}
      </Presence>
      {/*
        Only while placing the dots: it is the live check on the corners before Apply. In
        the openings editor the full rectified wall is already in the middle, so repeating
        it here would only push the openings list down.
      */}
      <Presence show={mode === "photo"}>
        <CustomSection title={t("photo.preview")} first>
          <RectifiedPreview working={working} corners={corners} wall={wall} />
        </CustomSection>
      </Presence>
      <CustomSection title={t("photo.rectifiedWall")} first={mode === "wall"}>
        <Presence value={applyError}>{(applyError) => <Hint error>{applyError}</Hint>}</Presence>
        {wallImage ? (
          <Hint>
            {t("photo.wallPixels", { width: wallImage.width, height: wallImage.height })}{" "}
            {mode === "photo" ? t("photo.applyToDraw") : t("photo.dragToDraw")}
          </Hint>
        ) : (
          !applyError && <Hint>{t("photo.applyToBuild")}</Hint>
        )}
        <Presence show={mode === "wall"}>
          <Hint>{t("photo.editHint")}</Hint>
        </Presence>
        <Presence value={mode === "wall" ? wallImage : null} className="flex flex-col gap-3">
          {() => (
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
        </Presence>
      </CustomSection>
      {mode === "wall" && extra}
      <Presence value={wall}>
        {() => (
          <OpeningsList
            openings={openings.list}
            selected={openings.selected}
            summary={openings.summary}
            onSelect={openings.select}
          />
        )}
      </Presence>
    </aside>
  );
}
