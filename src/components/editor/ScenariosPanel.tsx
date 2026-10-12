import { ISFP_CLASS_COLORS, isfpClass } from "@/geometry/isfp";
import { Presence } from "@/components/shared/Presence";
import { EnergyClassBadge } from "@/components/shared/EnergyClassBadge";
import { CustomFieldGroup } from "@/components/shared/CustomField";
import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { useId, useMemo, useState } from "react";
import { Copy, Eye, Plus, Trash2 } from "lucide-react";
import { buildRoadmap, evaluateAll, evaluateScenario } from "@/geometry/scenarios";
import type { Measure, ScenarioResult } from "@/geometry/scenarios";
import type { ConstructionCategory, Scenario } from "@/geometry/types";
import { CARRIERS, CARRIER_ORDER, heatingOf, priceWithCo2Of } from "@/geometry/supply";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomField, CustomReadOnly } from "@/components/shared/CustomField";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { cx } from "@/components/shared/cx";
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
  // The scenario chosen in the table; only a saved one can be changed below.
  const chosen = building.scenarios?.find((sc) => sc.id === viewScenarioId);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  const euro = (v: number) => `${num(v)} €`;
  // After subsidy: what the owner pays, and how long the saving takes to pay it back.
  const payback = (r: ScenarioResult) =>
    Number.isFinite(r.paybackOwnShare)
      ? `${num(r.paybackOwnShare, 1)} ${t("scenarios.years")}`
      : t("scenarios.never");

  return (
    <div className="flex flex-col gap-4">
      <Hint>
        {t("scenarios.costHint", {
          carrier: t(`carrier.${heatingOf(building).carrier}`),
          price: num(priceWithCo2Of(building, heatingOf(building).carrier), 2),
        })}
      </Hint>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="py-1 pr-3 font-medium whitespace-nowrap">{t("scenarios.title")}</th>
              <th
                className="py-1 pl-3 text-right font-medium whitespace-nowrap"
                title={t("energy.specificEndEnergy")}
              >
                kWh/(m²a)
              </th>
              <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">
                {t("subsidy.ownShare")}
              </th>
              <th className="py-1 pl-3 text-right font-medium whitespace-nowrap">
                {t("scenarios.payback")}
              </th>
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
              <td className="py-1.5 pl-3 text-right font-num whitespace-nowrap">
                {num(current.specificEndEnergy)}
              </td>
              <td className="py-1.5 pl-3 text-right font-num whitespace-nowrap text-muted">0 €</td>
              <td className="py-1.5 pl-3 text-right text-muted">{""}</td>
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
                      style={{
                        background: r.energy.energyClass
                          ? ENERGY_CLASS_COLORS[r.energy.energyClass]
                          : "var(--line)",
                      }}
                    />
                    {r.scenario.id === "full-envelope" ? t("scenarios.full") : r.scenario.name}
                  </button>
                </td>
                <td className="py-1.5 pl-3 text-right font-num whitespace-nowrap">
                  {num(r.energy.specificEndEnergy)}
                </td>
                <td
                  className="py-1.5 pl-3 text-right font-num whitespace-nowrap"
                  title={`${t("scenarios.investment")} ${euro(r.investment)}, ${t("subsidy.total")} ${euro(r.subsidy.total)}`}
                >
                  {euro(r.subsidy.ownShare)}
                </td>
                <td className="py-1.5 pl-3 text-right font-num whitespace-nowrap">{payback(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CustomButton
        variant="quiet"
        flush
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
      {chosen ? (
        <ScenarioEditor
          // A different scenario gets fresh fields, so a half-typed name cannot move to it.
          key={chosen.id}
          scenario={chosen}
          result={results.find((r) => r.scenario.id === chosen.id)}
          onChange={(patch) => {
            updateScenario(chosen.id, patch);
          }}
          onRemove={() => {
            removeScenario(chosen.id);
            setViewScenario(null);
          }}
          onDuplicate={() => {
            setViewScenario(addScenario(`${chosen.name} 2`, chosen));
          }}
          onShow={() => {
            setViewScenario(chosen.id);
          }}
        />
      ) : (
        (building.scenarios?.length ?? 0) > 0 && <Hint>{t("scenarios.pick")}</Hint>
      )}
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
              {/* Counted from 1: the first step is done in the first year. */}
              {t("scenarios.year", { n: s.year + 1 })}
            </span>
            <span className="min-w-0 truncate font-medium text-ink">
              {s.scenario.id === "full-envelope" ? t("scenarios.full") : s.scenario.name}
            </span>
            <EnergyClassBadge
              value={s.energy.energyClass}
              detail={num(s.energy.specificEndEnergy)}
            />
            <span className="col-span-3 flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ISFP_CLASS_COLORS[isfpClass(s.supply.primaryPerM2)] }}
              />
              {t("scenarios.stepEnergy", {
                primary: num(s.supply.primaryPerM2),
                co2: num(s.supply.co2 / 1000, 1),
              })}
            </span>
            <span className="col-span-3 text-xs text-muted">
              {t("scenarios.stepCost", {
                step: num(s.investment),
                total: num(s.cumulativeInvestment),
              })}
              {" · "}
              {t("scenarios.stepSowieso", { n: num(s.sowieso) })}
            </span>
            <span className="col-span-3 text-xs text-muted">
              {t("scenarios.stepCostAfter", { n: num(s.consumption.cost) })}
              {" · "}
              {t("scenarios.savingAfter", { n: num(s.savingPerYear) })}
            </span>
          </li>
        ))}
      </ol>
      <Presence value={last}>
        {(last) => (
          <Hint>
            {t("scenarios.roadmapHint", {
              years: num(last.year + 1),
              payback:
                last.savingPerYear > 0
                  ? num(last.cumulativeInvestment / last.savingPerYear, 1)
                  : t("scenarios.never"),
            })}
          </Hint>
        )}
      </Presence>
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
    <Card inset className="flex flex-col gap-3 p-3">
      <div className="flex items-end gap-1">
        <div className="flex-1">
          <ScenarioName
            value={scenario.name}
            onSave={(name) => {
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
      <CustomSelect
        label={t("supply.carrier")}
        value={scenario.heating?.carrier ?? ""}
        options={[
          { value: "", label: t("scenarios.keep") },
          ...CARRIER_ORDER.map((c) => ({ value: c, label: t(`carrier.${c}`) })),
        ]}
        onChange={(carrier) => {
          onChange({
            heating:
              carrier === ""
                ? undefined
                : {
                    carrier,
                    efficiency: CARRIERS[carrier].efficiency,
                    hotWater: heatingOf(building).hotWater,
                  },
          });
        }}
      />
      <CustomFieldGroup label={t("bridges.detail")}>
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
      </CustomFieldGroup>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <CustomReadOnly
          label={t("energy.energyClass")}
          value={r.energy.energyClass ?? t("energy.noClass")}
        />
        <CustomReadOnly
          label={t("energy.specificEndEnergy")}
          value={`${num(r.energy.specificEndEnergy)} kWh/(m²a)`}
        />
        <CustomReadOnly
          label={t("energy.specificHeatingDemand")}
          value={`${num(r.energy.specificHeatingDemand)} kWh/(m²a)`}
        />
        <CustomReadOnly label={t("scenarios.demandSaved")} value={`${num(r.demandSaved)} kWh/a`} />
        <CustomReadOnly label={t("scenarios.saving")} value={`${num(r.savingPerYear)} €`} />
      </div>
      <SubsidyBlock result={r} />
    </Card>
  );
}

/** The scenario's name: typed freely, kept with Save (or Enter), Escape goes back. */
function ScenarioName({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState(value);
  const changed = draft.trim() !== "" && draft.trim() !== value;
  const save = () => {
    if (changed) onSave(draft.trim());
  };
  return (
    <CustomField label={t("scenarios.name")} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setDraft(value);
          }}
          className="h-10 min-w-0 flex-1 rounded-inner border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-select"
        />
        <Presence show={changed}>
          <CustomButton variant="primary" onClick={save}>
            {t("scenarios.saveName")}
          </CustomButton>
        </Presence>
      </div>
    </CustomField>
  );
}

const measureLabel: Record<Measure["kind"], MessageKey> = {
  ...categoryLabel,
  heating: "supply.carrier",
};

/**
 * What each measure costs and whether the state pays towards it: the BEG limit for an
 * envelope measure, KfW for a renewable heating system; then subsidy, own share, payback.
 */
function SubsidyBlock({ result: r }: { result: ScenarioResult }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  const euro = (v: number) => `${num(v)} €`;
  const pct = (v: number) => `${num(v * 100)} %`;
  if (r.subsidy.measures.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <span className="text-xs font-semibold text-ink">{t("subsidy.title")}</span>
      <ul className="flex flex-col gap-1.5">
        {r.subsidy.measures.map(({ measure, reason, limit, subsidy }) => (
          <li key={measure.kind} className="flex flex-col text-xs">
            <span className="flex justify-between gap-2">
              <span className="text-ink">
                {measure.kind === "heating" && measure.heating
                  ? t(`carrier.${measure.heating.carrier}`)
                  : t(measureLabel[measure.kind])}
              </span>
              <span className="font-num text-ink">{euro(measure.cost)}</span>
            </span>
            <span className={reason === "eligible" ? "text-muted" : "text-mark"}>
              {reason === "eligible"
                ? measure.kind === "heating"
                  ? t("subsidy.kfw", { rate: pct(r.subsidy.heatingRate), amount: euro(subsidy) })
                  : t("subsidy.beg", {
                      u: num(measure.uValue ?? 0, 2),
                      limit: num(limit ?? 0, 2),
                      rate: pct(r.subsidy.envelopeRate),
                      amount: euro(subsidy),
                    })
                : reason === "uTooHigh"
                  ? t("subsidy.uTooHigh", {
                      u: num(measure.uValue ?? 0, 2),
                      limit: num(limit ?? 0, 2),
                    })
                  : t("subsidy.notRenewable")}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <CustomReadOnly label={t("scenarios.investment")} value={euro(r.investment)} />
        <CustomReadOnly label={t("subsidy.total")} value={euro(r.subsidy.total)} />
        <CustomReadOnly label={t("subsidy.ownShare")} value={euro(r.subsidy.ownShare)} />
        <CustomReadOnly
          label={t("subsidy.payback")}
          value={
            Number.isFinite(r.paybackOwnShare)
              ? `${num(r.paybackOwnShare, 1)} ${t("scenarios.years")}`
              : t("scenarios.never")
          }
        />
      </div>
      <Hint>{t("subsidy.hint")}</Hint>
    </div>
  );
}
