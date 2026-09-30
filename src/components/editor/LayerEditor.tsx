import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import { LAYERED_CATEGORIES, layersResistance, totalThickness } from "@/geometry/layers";
import type { Construction } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomReadOnly } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomTextInput } from "@/components/shared/CustomTextInput";
import { LayerSection } from "@/components/editor/LayerSection";

/** Editor for one construction's layer stack with the live U-value and the cross-section. */
export function LayerEditor({ construction }: { construction: Construction }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const addLayer = useEditorStore((s) => s.addLayer);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const removeLayer = useEditorStore((s) => s.removeLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const updateConstruction = useEditorStore((s) => s.updateConstruction);
  const beginBatch = useEditorStore((s) => s.beginBatch);
  const endBatch = useEditorStore((s) => s.endBatch);
  const batch = { onGestureStart: beginBatch, onGestureEnd: endBatch };
  const layers = construction.layers ?? [];
  const layered = LAYERED_CATEGORIES.includes(construction.category);

  if (!layered) {
    return (
      <CustomNumberInput
        label={`${construction.name}: ${t("energy.uValue")}`}
        value={construction.uValue}
        min={0.1}
        max={6}
        step={0.05}
        slider={false}
        unit={t("energy.uValueUnit")}
        language={language}
        onChange={(uValue) => {
          updateConstruction(construction.id, { uValue });
        }}
        {...batch}
      />
    );
  }

  return (
    <Card inset className="flex flex-col gap-3 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-sm font-semibold text-ink">{construction.name}</span>
        <span className="font-num text-sm text-ink">
          U = {formatNumber(construction.uValue, language, 3)} {t("energy.uValueUnit")}
        </span>
      </div>
      {layers.length > 0 ? (
        <LayerSection layers={layers} language={language} />
      ) : (
        <Hint>{t("layers.typedHint")}</Hint>
      )}
      <ol className="flex flex-col gap-3">
        {layers.map((l, i) => (
          <li key={l.id} className="flex min-w-0 flex-col gap-2.5 border-t border-line pt-3">
            <div className="flex items-center gap-2">
              <span className="w-5 shrink-0 font-num text-xs text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <CustomTextInput
                  label={t("layers.name")}
                  value={l.name}
                  hideLabel
                  onCommit={(name) => {
                    updateLayer(construction.id, l.id, { name });
                  }}
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <CustomIconButton
                  label={t("layers.up")}
                  size="sm"
                  disabled={i === 0}
                  onClick={() => {
                    moveLayer(construction.id, l.id, -1);
                  }}
                >
                  <ArrowLeft size={14} />
                </CustomIconButton>
                <CustomIconButton
                  label={t("layers.down")}
                  size="sm"
                  disabled={i === layers.length - 1}
                  onClick={() => {
                    moveLayer(construction.id, l.id, 1);
                  }}
                >
                  <ArrowRight size={14} />
                </CustomIconButton>
                <CustomIconButton
                  label={t("layers.remove")}
                  size="sm"
                  onClick={() => {
                    removeLayer(construction.id, l.id);
                  }}
                >
                  <Trash2 size={14} />
                </CustomIconButton>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 min-w-0">
              <CustomNumberInput
                label={t("layers.thickness")}
                value={Math.round(l.thickness * 1000 * 10) / 10}
                min={1}
                max={1000}
                step={0.5}
                slider={false}
                unit="mm"
                language={language}
                onChange={(mm) => {
                  updateLayer(construction.id, l.id, { thickness: mm / 1000 });
                }}
                {...batch}
              />
              <CustomNumberInput
                label={t("layers.conductivity")}
                value={l.conductivity}
                min={0.01}
                max={5}
                step={0.005}
                slider={false}
                unit="W/(m·K)"
                language={language}
                onChange={(conductivity) => {
                  updateLayer(construction.id, l.id, { conductivity });
                }}
                {...batch}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-1 border-t border-line pt-3">
        <CustomReadOnly
          label={t("layers.total")}
          value={`${formatNumber(totalThickness(layers) * 1000, language, 1)} mm`}
        />
        <CustomReadOnly
          label={t("layers.resistance")}
          value={`${formatNumber(layersResistance(layers), language, 3)} m²·K/W`}
        />
      </div>
      <CustomButton
        variant="quiet"
        className="self-start"
        icon={<Plus size={14} />}
        onClick={() => {
          addLayer(construction.id);
        }}
      >
        {t("layers.add")}
      </CustomButton>
    </Card>
  );
}
