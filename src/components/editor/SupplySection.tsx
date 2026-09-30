import { Hint } from "@/components/shared/Hint";
import { useMemo } from "react";
import {
  CARRIERS,
  CARRIER_ORDER,
  economicsOf,
  heatingOf,
  priceOf,
  supplyOf,
} from "@/geometry/supply";
import type { SupplySummary } from "@/geometry/supply";
import type { EnergySummary } from "@/geometry/energy";
import type { Building, EnergyCarrier, HeatingSystem } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSelect } from "@/components/shared/CustomSelect";

const isHeatPump = (carrier: EnergyCarrier) =>
  carrier === "heatPumpAir" || carrier === "heatPumpGround";

/**
 * The heating system and the money: what the building buys, emits and costs in a year, now
 * and in the scenario on show, and the inputs those numbers hang on. The part of the
 * balance an energy consultant talks about with the client.
 */
export function SupplySection({
  building,
  current,
  shownBuilding,
  shown,
  compare,
  scenarioId = null,
  readOnly = false,
}: {
  building: Building;
  current: EnergySummary;
  /** The scenario on show, when there is one. */
  shownBuilding: Building;
  shown: EnergySummary;
  compare: boolean;
  /** The saved scenario on show: the heating inputs show and change its heating. */
  scenarioId?: string | null;
  /** A scenario that cannot be edited (the built-in full envelope variant) is on show. */
  readOnly?: boolean;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const setBuildingHeating = useEditorStore((s) => s.setHeating);
  const updateScenario = useEditorStore((s) => s.updateScenario);
  const setEconomics = useEditorStore((s) => s.setEconomics);
  const beginBatch = useEditorStore((s) => s.beginBatch);
  const endBatch = useEditorStore((s) => s.endBatch);
  const batch = { onGestureStart: beginBatch, onGestureEnd: endBatch };

  const now = useMemo(() => supplyOf(building, current), [building, current]);
  const after = useMemo(() => supplyOf(shownBuilding, shown), [shownBuilding, shown]);
  const heating = heatingOf(shownBuilding);
  const setHeating = (patch: Partial<HeatingSystem>) => {
    if (scenarioId) updateScenario(scenarioId, { heating: { ...heating, ...patch } });
    else setBuildingHeating(patch);
  };
  const economics = economicsOf(building);
  const pump = isHeatPump(heating.carrier);

  const num = (v: number, digits = 0) => formatNumber(v, language, digits);
  const rows: { label: MessageKey; value: (s: SupplySummary) => string }[] = [
    { label: "supply.endEnergy", value: (s) => `${num(s.endEnergy)} kWh/a` },
    { label: "supply.endPerM2", value: (s) => `${num(s.endPerM2)} kWh/(m²a)` },
    { label: "supply.primaryPerM2", value: (s) => `${num(s.primaryPerM2)} kWh/(m²a)` },
    { label: "supply.co2", value: (s) => `${num(s.co2 / 1000, 1)} t/a` },
    { label: "supply.co2PerM2", value: (s) => `${num(s.co2PerM2, 1)} kg/(m²a)` },
    { label: "supply.cost", value: (s) => `${num(s.cost)} €/a` },
    { label: "supply.co2Cost", value: (s) => `${num(s.co2Cost)} €/a` },
  ];
  if (!economics.ownerOccupied) {
    rows.push({
      label: "supply.landlord",
      value: (s) => `${num(s.landlordShare * 100)} % · ${num(s.co2Cost * s.landlordShare)} €/a`,
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="text-sm font-semibold text-ink">{t("supply.title")}</h3>

      <CustomSelect
        label={t("supply.carrier")}
        value={heating.carrier}
        disabled={readOnly}
        options={CARRIER_ORDER.map((c) => ({ value: c, label: t(`carrier.${c}`) }))}
        onChange={(carrier) => {
          // A new carrier comes with its typical efficiency; the consultant corrects it.
          setHeating({ carrier, efficiency: CARRIERS[carrier].efficiency });
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <CustomNumberInput
          label={pump ? t("supply.cop") : t("supply.efficiency")}
          value={heating.efficiency}
          min={pump ? 1.5 : 0.5}
          max={pump ? 6 : 1.1}
          step={pump ? 0.1 : 0.01}
          language={language}
          slider={false}
          disabled={readOnly}
          onChange={(efficiency) => {
            setHeating({ efficiency });
          }}
          {...batch}
        />
        <CustomNumberInput
          label={t("supply.hotWater")}
          value={heating.hotWater}
          min={0}
          max={40}
          step={0.5}
          unit="kWh/m²a"
          language={language}
          slider={false}
          disabled={readOnly}
          onChange={(hotWater) => {
            setHeating({ hotWater });
          }}
          {...batch}
        />
        <CustomNumberInput
          label={t("supply.price")}
          value={Math.round(priceOf(building, heating.carrier) * 1000) / 10}
          min={0}
          max={100}
          step={0.1}
          unit="ct/kWh"
          language={language}
          slider={false}
          onChange={(ct) => {
            setEconomics({ prices: { [heating.carrier]: ct / 100 } });
          }}
          {...batch}
        />
        <CustomNumberInput
          label={t("supply.co2Price")}
          value={economics.co2Price}
          min={0}
          max={300}
          step={5}
          unit="€/t"
          language={language}
          slider={false}
          onChange={(co2Price) => {
            setEconomics({ co2Price });
          }}
          {...batch}
        />
        <CustomNumberInput
          label={t("supply.dwellings")}
          value={economics.dwellings}
          min={1}
          max={500}
          step={1}
          language={language}
          slider={false}
          onChange={(dwellings) => {
            setEconomics({ dwellings: Math.max(1, Math.round(dwellings)) });
          }}
          {...batch}
        />
      </div>
      <CustomCheckbox
        variant="switch"
        label={t("supply.ownerOccupied")}
        checked={economics.ownerOccupied}
        onChange={(ownerOccupied) => {
          setEconomics({ ownerOccupied });
        }}
      />
      <CustomCheckbox
        variant="switch"
        label={t("supply.isfp")}
        checked={economics.isfp}
        onChange={(isfp) => {
          setEconomics({ isfp });
        }}
      />

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted">
            <th className="py-1 text-left font-medium" />
            <th className="py-1 text-right font-medium">{t("supply.now")}</th>
            {compare && <th className="py-1 text-right font-medium">{t("supply.after")}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <td className="py-1.5 pr-2 text-muted">{t(row.label)}</td>
              <td className="py-1.5 text-right font-num text-ink">{row.value(now)}</td>
              {compare && (
                <td className="py-1.5 text-right font-num text-ink">{row.value(after)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <Hint>{t("supply.hint")}</Hint>
    </div>
  );
}
