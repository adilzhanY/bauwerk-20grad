import { Presence } from "@/components/shared/Presence";
import { Hint } from "@/components/shared/Hint";
import { UploadDialog } from "@/components/shared/UploadDialog";
import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { distance } from "@/geometry/polygon";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomSection } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";

/**
 * A drawing on the ground under the model, to trace by hand. Local UI state only.
 * `collapsible` folds it under its title, closed.
 */
export function UnderlaySection({ collapsible = false }: { collapsible?: boolean } = {}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const underlay = useEditorStore((s) => s.underlay);
  const setUnderlay = useEditorStore((s) => s.setUnderlay);
  const measurement = useEditorStore((s) => s.measurement);
  const [choosing, setChoosing] = useState(false);
  const [knownLength, setKnownLength] = useState(5);

  const load = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      if (underlay) URL.revokeObjectURL(underlay.url);
      setUnderlay({
        url,
        widthMetres: 20,
        aspect: img.height / img.width,
        x: 5,
        y: 4,
        opacity: 0.6,
      });
    };
    img.src = url;
  };

  const applyScale = () => {
    if (!underlay || !measurement) return;
    const measured = distance(measurement.a, measurement.b);
    if (measured <= 0) return;
    setUnderlay({ ...underlay, widthMetres: (underlay.widthMetres * knownLength) / measured });
  };

  const m = t("common.metres");
  const set = (patch: Partial<NonNullable<typeof underlay>>) => {
    if (underlay) setUnderlay({ ...underlay, ...patch });
  };

  return (
    <CustomSection title={t("underlay.title")} collapsible={collapsible}>
      <div className="flex flex-wrap gap-2">
        <CustomButton
          variant="quiet"
          flush
          icon={<ImagePlus size={14} />}
          onClick={() => {
            setChoosing(true);
          }}
        >
          {t("underlay.load")}
        </CustomButton>
        {underlay && (
          <CustomButton
            variant="quiet"
            icon={<Trash2 size={14} />}
            onClick={() => {
              URL.revokeObjectURL(underlay.url);
              setUnderlay(null);
            }}
          >
            {t("underlay.remove")}
          </CustomButton>
        )}
      </div>
      <Presence show={choosing} kind="float">
        <UploadDialog
          title={t("underlay.load")}
          accept="image/*"
          onClose={() => {
            setChoosing(false);
          }}
          onFiles={(files) => {
            setChoosing(false);
            const file = files[0];
            if (file) load(file);
          }}
        />
      </Presence>
      <Presence value={underlay} className="flex flex-col gap-3.5">
        {(underlay) => (
          <>
            <CustomNumberInput
              label={t("underlay.width")}
              value={underlay.widthMetres}
              min={1}
              max={200}
              step={0.1}
              unit={m}
              language={language}
              onChange={(widthMetres) => {
                set({ widthMetres });
              }}
            />
            <CustomNumberInput
              label={t("underlay.x")}
              value={underlay.x}
              min={-100}
              max={100}
              step={0.1}
              unit={m}
              language={language}
              onChange={(x) => {
                set({ x });
              }}
            />
            <CustomNumberInput
              label={t("underlay.y")}
              value={underlay.y}
              min={-100}
              max={100}
              step={0.1}
              unit={m}
              language={language}
              onChange={(y) => {
                set({ y });
              }}
            />
            <CustomNumberInput
              label={t("underlay.opacity")}
              value={underlay.opacity}
              min={0.1}
              max={1}
              step={0.05}
              language={language}
              onChange={(opacity) => {
                set({ opacity });
              }}
            />
            <Hint>{t("underlay.scaleHint")}</Hint>
            <CustomNumberInput
              label={t("underlay.knownLength")}
              value={knownLength}
              min={0.1}
              max={100}
              step={0.1}
              unit={m}
              slider={false}
              language={language}
              onChange={setKnownLength}
            />
            <CustomButton disabled={!measurement} onClick={applyScale} className="self-start">
              {t("underlay.applyScale")}
            </CustomButton>
          </>
        )}
      </Presence>
      <Hint>{t("underlay.local")}</Hint>
    </CustomSection>
  );
}
