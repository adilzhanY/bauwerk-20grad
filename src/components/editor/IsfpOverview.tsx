import { useMemo } from "react";
import type { EnergySummary } from "@/geometry/energy";
import { HEAT_PUMP_FLOW, heatPumpReadiness } from "@/geometry/hvac";
import { ISFP_CLASS_COLORS, ISFP_CLASS_UPPER, ehCheck, isfpClass } from "@/geometry/isfp";
import { supplyOf } from "@/geometry/supply";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { Card } from "@/components/shared/Card";
import { CustomReadOnly } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { cx } from "@/components/shared/cx";

/**
 * The figures an iSFP leads with, for the building or the scenario on show: the colour class
 * on primary energy, CO2, where the envelope stands against the Effizienzhaus levels, and
 * whether the heating surfaces are ready for a heat pump at 55 °C.
 */
export function IsfpOverview({ building, energy }: { building: Building; energy: EnergySummary }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const supply = useMemo(() => supplyOf(building, energy), [building, energy]);
  const eh = useMemo(() => ehCheck(building, energy), [building, energy]);
  const pump = useMemo(() => heatPumpReadiness(building), [building]);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  const colour = isfpClass(supply.primaryPerM2);
  const lowTemp =
    pump.rooms.length === 0
      ? t("isfp.lowTempUnknown")
      : pump.flow === null
        ? t("isfp.lowTempOver")
        : pump.flow <= HEAT_PUMP_FLOW
          ? t("isfp.lowTempYes")
          : t("isfp.lowTempNo", { flow: num(pump.flow) });

  return (
    <Card inset className="flex flex-col gap-2 p-3">
      <span className="text-xs font-semibold text-ink">{t("isfp.title")}</span>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">{t("isfp.class")}</span>
          <span className="font-num text-ink">{num(supply.primaryPerM2)} kWh/(m²a)</span>
        </div>
        <div
          className="flex h-5 overflow-hidden rounded-soft"
          role="img"
          aria-label={t("isfp.class")}
        >
          {ISFP_CLASS_COLORS.map((color, i) => (
            <span
              key={color}
              className={cx(
                "flex flex-1 items-center justify-center font-num text-xs text-white",
                i === colour && "outline-2 -outline-offset-2 outline-ink",
              )}
              style={{ background: color }}
            >
              {i < ISFP_CLASS_UPPER.length
                ? ISFP_CLASS_UPPER[i]
                : `>${String(ISFP_CLASS_UPPER.at(-1))}`}
            </span>
          ))}
        </div>
      </div>
      <CustomReadOnly label={t("isfp.co2")} value={`${num(supply.co2 / 1000, 1)} t`} />
      <CustomReadOnly
        label={t("isfp.eh")}
        value={`${num(eh.ratio * 100)} % · ${eh.level ? t("isfp.ehLevel", { level: eh.level }) : t("isfp.ehNone")}`}
      />
      <CustomReadOnly label={t("isfp.lowTemp")} value={lowTemp} />
      <Hint>{t("isfp.ehHint")}</Hint>
    </Card>
  );
}
