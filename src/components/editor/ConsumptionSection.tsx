import { useMemo } from "react";
import type { EnergySummary } from "@/geometry/energy";
import { currentConsumption, livingAreaOf } from "@/geometry/isfp";
import { economicsOf } from "@/geometry/supply";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomReadOnly } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { Hint } from "@/components/shared/Hint";

/**
 * Demand against use, as an iSFP compares them: the bills when the consultant has them, the
 * typical consumption otherwise. The expected use is what the energy costs and every
 * scenario's saving are read from.
 */
export function ConsumptionSection({
  building,
  current,
}: {
  building: Building;
  current: EnergySummary;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const setEconomics = useEditorStore((s) => s.setEconomics);
  const setEnergyMethod = useEditorStore((s) => s.setEnergyMethod);
  const beginBatch = useEditorStore((s) => s.beginBatch);
  const endBatch = useEditorStore((s) => s.endBatch);
  const batch = { onGestureStart: beginBatch, onGestureEnd: endBatch };
  const c = useMemo(() => currentConsumption(building, current), [building, current]);
  const measured = economicsOf(building).consumption ?? 0;
  const num = (v: number, d = 0) => formatNumber(v, language, d);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("consumption.title")}</span>
      <div className="grid grid-cols-2 gap-2">
        <CustomNumberInput
          label={t("consumption.measured")}
          value={measured}
          min={0}
          max={10_000_000}
          step={100}
          unit="kWh/a"
          language={language}
          slider={false}
          onChange={(v) => {
            setEconomics({ consumption: v > 0 ? v : undefined });
          }}
          {...batch}
        />
        <CustomNumberInput
          label={t("consumption.living")}
          value={Math.round(livingAreaOf(building, current))}
          min={1}
          max={1_000_000}
          step={1}
          unit="m²"
          language={language}
          slider={false}
          onChange={(v) => {
            setEnergyMethod({ livingArea: v > 0 ? v : undefined });
          }}
          {...batch}
        />
      </div>
      <CustomReadOnly label={t("consumption.expected")} value={`${num(c.expected)} kWh/a`} />
      <CustomReadOnly label={t("consumption.deviation")} value={`${num(c.factor * 100)} %`} />
      <CustomReadOnly label={t("consumption.cost")} value={`${num(c.cost)} €/a`} />
      <Hint>{t(c.source === "bills" ? "consumption.billsHint" : "consumption.typicalHint")}</Hint>
    </div>
  );
}
