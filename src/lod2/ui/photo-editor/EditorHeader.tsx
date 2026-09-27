import { useEffect } from "react";
import { ArrowLeft, Check, ImagePlus, Sparkles, X } from "lucide-react";
import { CustomUndoRedo } from "@/components/CustomUndoRedo";
import { useT } from "@/i18n/useT";
import { CustomButton } from "../../components/CustomButton.tsx";
import { CustomIconButton } from "../../components/CustomIconButton.tsx";
import { CustomSlider } from "../../components/CustomSlider.tsx";
import { LOUPE_ZOOM_MAX, LOUPE_ZOOM_MIN, LOUPE_ZOOM_STEP } from "./constants.ts";
import type { EditorMode } from "./types.ts";
import { useFormat } from "../format.ts";

/** The editor's top bar: file picker, wall size, loupe zoom, and the step buttons. */
export function EditorHeader({
  mode,
  wallText,
  fileInput,
  onChoosePhoto,
  onFileChosen,
  onPickerCancelled,
  showLoupe,
  loupeZoom,
  onLoupeZoom,
  showDetect,
  onDetect,
  applying,
  canApply,
  onApply,
  onBack,
  onClose,
  history,
  action,
}: {
  mode: EditorMode;
  wallText: string;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onChoosePhoto: () => void;
  onFileChosen: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPickerCancelled: () => void;
  showLoupe: boolean;
  loupeZoom: number;
  onLoupeZoom: (zoom: number) => void;
  showDetect: boolean;
  onDetect: () => void;
  applying: boolean;
  canApply: boolean;
  onApply: () => void;
  onBack: () => void;
  onClose: () => void;
  /** Undo and redo for the openings, shown while the wall is edited. */
  history: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void } | null;
  /** The last word on the wall step, for example applying the openings to the 3D model. */
  action?: React.ReactNode;
}) {
  const format = useFormat();
  const t = useT();
  // The file picker's cancel event is not in React's props, so it is listened to directly.
  useEffect(() => {
    const input = fileInput.current;
    if (!input) return;
    input.addEventListener("cancel", onPickerCancelled);
    return () => {
      input.removeEventListener("cancel", onPickerCancelled);
    };
  }, [fileInput, onPickerCancelled]);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-4">
      <h2 className="text-xl font-bold tracking-tight text-ink">{t("photo.title")}</h2>
      {history && <CustomUndoRedo {...history} />}
      <CustomButton icon={<ImagePlus size={15} aria-hidden />} onClick={onChoosePhoto}>
        {t("photo.choosePhoto")}
      </CustomButton>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFileChosen} />
      <span className="text-xs text-muted">{wallText}</span>
      <span className="flex-1" />
      {showLoupe && (
        <div className="flex w-56 items-center gap-2" title={t("photo.loupeHint")}>
          <span className="text-xs font-medium text-muted select-none">{t("photo.loupe")}</span>
          <CustomSlider
            label={t("photo.loupeZoom")}
            value={loupeZoom}
            min={LOUPE_ZOOM_MIN}
            max={LOUPE_ZOOM_MAX}
            step={LOUPE_ZOOM_STEP}
            onChange={onLoupeZoom}
            format={(v) => `${format.num(v, 2)}x`}
          />
          <span className="w-12 text-right font-num text-xs text-ink">
            {format.num(loupeZoom, 2)}x
          </span>
        </div>
      )}
      {mode === "wall" && (
        <CustomButton variant="quiet" icon={<ArrowLeft size={15} aria-hidden />} onClick={onBack}>
          {t("photo.backToPhoto")}
        </CustomButton>
      )}
      {/* On the wall, not on the photo: it reads the openings off the rectified wall as it is. */}
      {showDetect && (
        <CustomButton icon={<Sparkles size={15} aria-hidden />} onClick={onDetect}>
          {t("photo.detect")}
        </CustomButton>
      )}
      {/* Apply belongs to the corner step; the wall view offers "Back to photo" instead. */}
      {mode === "photo" && (
        <CustomButton
          variant="primary"
          icon={<Check size={15} aria-hidden />}
          loading={applying}
          disabled={!canApply}
          onClick={onApply}
        >
          {applying ? t("photo.working") : t("photo.apply")}
        </CustomButton>
      )}
      {mode === "wall" && action}
      <CustomIconButton label={t("photo.close")} onClick={onClose}>
        <X size={16} aria-hidden />
      </CustomIconButton>
    </header>
  );
}
