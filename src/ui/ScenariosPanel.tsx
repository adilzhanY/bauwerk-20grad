import { useMemo } from "react";
import { Copy, Eye, Plus, Trash2 } from "lucide-react";
import {
  ENERGY_PRICE_PER_KWH,
  buildRoadmap,
  evaluateAll,
  evaluateScenario,
} from "@/geometry/scenarios";
import type { ScenarioResult } from "@/geometry/scenarios";
import type { ConstructionCategory, Scenario } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/CustomButton";
import { CustomIconButton } from "@/components/CustomIconButton";
import { CustomReadOnly } from "@/components/CustomField";
import { CustomSegmented } from "@/components/CustomSegmented";
import { CustomSelect } from "@/components/CustomSelect";
import { CustomTextInput } from "@/components/CustomTextInput";
import { cx } from "@/components/cx";
import { computeEnergy, ENERGY_CLASS_COLORS } from "@/geometry/energy";

const categoryLabel: Record<ConstructionCategory, MessageKey> = {
  wall: "energy.wallConstruction",
  floor: "energy.floorConstruction",
  roof: "energy.roofConstruction",
  window: "energy.windowDefault",
  door: "energy.doorDefault",
};

export function ScenariosPanel() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const viewScenarioId = useEditorStore((s) => s.viewScenarioId);
  const setViewScenario = useEditorStore((s) => s.setViewScenario);
  const addScenario = useEditorStore((s) => s.addScenario);
  const updateScenario = useEditorStore((s) => s.updateScenario);
  const removeScenario = useEditorStore((s) => s.removeScenario);
  const results = useMemo(() => evaluateAll(building), [building]);
  const current = useMemo(() => computeEnergy(building), [building]);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  const euro = (v: number) => `${num(v)} €`;
  const payback = (r: ScenarioResult) =>
    Number.isFinite(r.payback)
      ? `${num(r.payback, 1)} ${t("scenarios.years")}`
      : t("scenarios.never");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted">
        {t("scenarios.costHint", { price: num(ENERGY_PRICE_PER_KWH, 2) })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="py-1 font-medium">{t("scenarios.title")}</th>
              <th className="py-1 text-right font-medium">kWh/(m²a)</th>
              <th className="py-1 text-right font-medium">{t("scenarios.investment")}</th>
              <th className="py-1 text-right font-medium">{t("scenarios.payback")}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              className={cx("border-b border-line", viewScenarioId === null && "bg-select-soft/50")}
            >
              <td className="py-1.5">
                <button
                  type="button"
                  className="text-left text-ink"
                  onClick={() => {
                    setViewScenario(null);
                  }}
                >
                  {t("scenarios.current")}
                </button>
              </td>
              <td className="py-1.5 text-right font-num">{num(current.specificHeatingDemand)}</td>
              <td className="py-1.5 text-right font-num text-muted">0 €</td>
              <td className="py-1.5 text-right text-muted">{""}</td>
            </tr>
            {results.map((r) => (
              <tr
                key={r.scenario.id}
                className={cx(
                  "border-b border-line",
                  viewScenarioId === r.scenario.id && "bg-select-soft/50",
                )}
              >
                <td className="py-1.5">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 text-left text-ink"
                    onClick={() => {
                      setViewScenario(r.scenario.id);
                    }}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: ENERGY_CLASS_COLORS[r.energy.energyClass] }}
                    />
                    {r.scenario.id === "full-envelope" ? t("scenarios.full") : r.scenario.name}
                  </button>
                </td>
                <td className="py-1.5 text-right font-num">
                  {num(r.energy.specificHeatingDemand)}
                </td>
                <td className="py-1.5 text-right font-num">{euro(r.investment)}</td>
                <td className="py-1.5 text-right font-num">{payback(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CustomButton
        variant="quiet"
        className="self-start"
        icon={<Plus size={14} />}
        onClick={() => {
          const id = addScenario(
            t("scenarios.defaultName", { n: (building.scenarios?.length ?? 0) + 1 }),
          );
          setViewScenario(id);
        }}
      >
        {t("scenarios.add")}
      </CustomButton>
      <Roadmap />
      {(building.scenarios ?? []).map((sc) => (
        <ScenarioEditor
          key={sc.id}
          scenario={sc}
          result={results.find((r) => r.scenario.id === sc.id)}
          onChange={(patch) => {
            updateScenario(sc.id, patch);
          }}
          onRemove={() => {
            removeScenario(sc.id);
          }}
          onDuplicate={() => {
            addScenario(`${sc.name} 2`, sc);
          }}
          onShow={() => {
            setViewScenario(sc.id);
          }}
        />
      ))}
    </div>
  );
}

/** The saved scenarios as one sequence, cheapest payback first, each step on the previous. */
function Roadmap() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const steps = useMemo(() => buildRoadmap(building), [building]);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  const last = steps[steps.length - 1];
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("scenarios.roadmap")}</span>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li
            key={s.scenario.id}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 rounded-inner bg-paper px-3 py-2 text-sm"
          >
            <span className="font-num text-xs text-muted">
              {t("scenarios.year", { n: s.year })}
            </span>
            <span className="min-w-0 truncate font-medium text-ink">
              {s.scenario.id === "full-envelope" ? t("scenarios.full") : s.scenario.name}
            </span>
            <span
              className="rounded-control px-2 py-0.5 font-num text-xs font-semibold"
              style={{
                background: ENERGY_CLASS_COLORS[s.energy.energyClass],
                color: "var(--fixed-ink)",
              }}
            >
              {s.energy.energyClass} · {num(s.energy.specificHeatingDemand)}
            </span>
            <span className="col-span-3 font-num text-xs text-muted">
              {t("scenarios.stepCost", {
                step: num(s.investment),
                total: num(s.cumulativeInvestment),
              })}
              {" · "}
              {t("scenarios.savingAfter", { n: num(s.savingPerYear) })}
            </span>
          </li>
        ))}
      </ol>
      {last && (
        <p className="text-xs leading-relaxed text-muted">
          {t("scenarios.roadmapHint", {
            years: num(last.year),
            payback:
              last.savingPerYear > 0
                ? num(last.cumulativeInvestment / last.savingPerYear, 1)
                : t("scenarios.never"),
          })}
        </p>
      )}
    </div>
  );
}

function ScenarioEditor({
  scenario,
  result,
  onChange,
  onRemove,
  onDuplicate,
  onShow,
}: {
  scenario: Scenario;
  result: ScenarioResult | undefined;
  onChange: (patch: Partial<Omit<Scenario, "id">>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onShow: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const constructions = useEditorStore((s) => s.building.constructions);
  const building = useEditorStore((s) => s.building);
  const r = result ?? evaluateScenario(building, scenario);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  return (
    <div className="flex flex-col gap-3 rounded-inner border border-line bg-paper p-3">
      <div className="flex items-end gap-1">
        <div className="flex-1">
          <CustomTextInput
            label={t("scenarios.title")}
            value={scenario.name}
            onCommit={(name) => {
              onChange({ name });
            }}
          />
        </div>
        <CustomIconButton label={t("scenarios.show")} size="sm" onClick={onShow}>
          <Eye size={14} />
        </CustomIconButton>
        <CustomIconButton label={t("scenarios.duplicate")} size="sm" onClick={onDuplicate}>
          <Copy size={14} />
        </CustomIconButton>
        <CustomIconButton label={t("scenarios.remove")} size="sm" onClick={onRemove}>
          <Trash2 size={14} />
        </CustomIconButton>
      </div>
      {(["wall", "roof", "floor", "window", "door"] as const).map((category) => (
        <CustomSelect
          key={category}
          label={t(categoryLabel[category])}
          value={scenario.overrides[category] ?? ""}
          options={[
            { value: "", label: t("scenarios.keep") },
            ...constructions
              .filter((c) => c.category === category)
              .map((c) => ({ value: c.id, label: c.name, detail: String(c.uValue) })),
          ]}
          onChange={(id) => {
            const overrides = Object.fromEntries(
              Object.entries(scenario.overrides).filter(([k]) => k !== category),
            ) as Scenario["overrides"];
            if (id !== "") overrides[category] = id;
            onChange({ overrides });
          }}
        />
      ))}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">{t("bridges.detail")}</span>
        <CustomSegmented
          label={t("bridges.detail")}
          value={scenario.bridgeDetail ?? "keep"}
          options={[
            { value: "keep", label: t("scenarios.keep") },
            { value: "poor", label: t("bridges.poor") },
            { value: "good", label: t("bridges.good") },
          ]}
          onChange={(v) => {
            onChange({ bridgeDetail: v === "keep" ? undefined : v });
          }}
        />
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <CustomReadOnly label={t("energy.energyClass")} value={r.energy.energyClass} />
        <CustomReadOnly
          label={t("energy.specificHeatingDemand")}
          value={`${num(r.energy.specificHeatingDemand)} kWh/(m²a)`}
        />
        <CustomReadOnly label={t("scenarios.demandSaved")} value={`${num(r.demandSaved)} kWh/a`} />
        <CustomReadOnly label={t("scenarios.investment")} value={`${num(r.investment)} €`} />
        <CustomReadOnly label={t("scenarios.saving")} value={`${num(r.savingPerYear)} €`} />
        <CustomReadOnly
          label={t("scenarios.payback")}
          value={
            Number.isFinite(r.payback)
              ? `${num(r.payback, 1)} ${t("scenarios.years")}`
              : t("scenarios.never")
          }
        />
      </div>
    </div>
  );
}
