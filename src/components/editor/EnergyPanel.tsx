import { Presence } from "@/components/shared/Presence";
import { CustomFieldGroup } from "@/components/shared/CustomField";
import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { useMemo } from "react";
import { bestInCategory } from "@/geometry/constructions";
import { computeEnergy } from "@/geometry/energy";
import { EnergyScale } from "@/components/shared/EnergyScale";
import { applyScenario, evaluateAll } from "@/geometry/scenarios";
import { gegChecks, gegPassCount } from "@/geometry/geg";
import { cx } from "@/components/shared/cx";
import type { EnergySummary, Orientation } from "@/geometry/energy";
import type { Building, ConstructionCategory } from "@/geometry/types";
import {
  DESIGN_OUTDOOR_TEMPERATURE,
  HEAT_PUMP_FLOW,
  heatPumpReadiness,
  roomHeatLoads,
  suggestHeatPumpPower,
} from "@/geometry/hvac";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatArea, formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import type { ConstructionTarget } from "@/store/building";
import { CustomReadOnly } from "@/components/shared/CustomField";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { LayerEditor } from "@/components/editor/LayerEditor";
import { SupplySection } from "@/components/editor/SupplySection";
import { AreaListSection } from "@/components/editor/AreaListSection";
import { AgeDefaultsSection } from "@/components/editor/AgeDefaultsSection";
import { ConsumptionSection } from "@/components/editor/ConsumptionSection";
import { EnergyChangeNote } from "@/components/editor/EnergyChangeNote";
import { IsfpOverview } from "@/components/editor/IsfpOverview";
import { MethodSection } from "@/components/editor/MethodSection";

/**
 * What the Variants step shows of one variant: the building as the chosen variant leaves it
 * and its energy, shared by the results and the inputs so both always show the same variant.
 */
function useEnergyView() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const viewScenarioId = useEditorStore((s) => s.viewScenarioId);
  const setViewScenario = useEditorStore((s) => s.setViewScenario);

  const current = useMemo(() => computeEnergy(building), [building]);
  const variants = useMemo(() => evaluateAll(building), [building]);
  const chosen = variants.find((v) => v.scenario.id === viewScenarioId);
  const renovated = chosen !== undefined;
  const after = chosen?.energy ?? current;
  const shown = after;
  const shownBuilding = useMemo(
    () => (chosen ? applyScenario(building, chosen.scenario) : building),
    [building, chosen],
  );
  const saving = current.heatingDemand > 0 ? 1 - after.heatingDemand / current.heatingDemand : 0;
  // The inputs below show the chosen scenario; a saved one takes their edits, the built-in
  // full envelope variant is read only.
  const scenarioId =
    chosen && building.scenarios?.some((sc) => sc.id === chosen.scenario.id)
      ? chosen.scenario.id
      : null;
  const readOnly = renovated && scenarioId === null;

  return {
    t,
    language,
    building,
    viewScenarioId,
    setViewScenario,
    current,
    variants,
    chosen,
    renovated,
    after,
    shown,
    shownBuilding,
    saving,
    scenarioId,
    readOnly,
  };
}

/** Numbers in the interface language: `num` with digits, `pct` for a share. */
function useNumbers(language: ReturnType<typeof useEnergyView>["language"]) {
  const num = (v: number, digits = 1) => formatNumber(v, language, digits);
  const pct = (v: number) => `${num(v * 100, 0)} %`;
  return { num, pct };
}

/**
 * The result of the variant on show: the switch between the variants, the energy class, the
 * iSFP overview and the demand. It follows every input at once, so it can stay in sight
 * while the inputs are changed beside it.
 */
export function EnergyResults() {
  const {
    t,
    language,
    building,
    viewScenarioId,
    setViewScenario,
    current,
    variants,
    chosen,
    renovated,
    after,
    shown,
    shownBuilding,
    saving,
  } = useEnergyView();
  const { num, pct } = useNumbers(language);
  return (
    <div className="flex flex-col gap-4">
      <CustomSegmented
        label={t("energy.title")}
        value={viewScenarioId ?? "current"}
        options={[
          { value: "current", label: t("energy.scenario.current") },
          ...variants.map((v) => ({
            value: v.scenario.id,
            label:
              v.scenario.id === "full-envelope" ? t("energy.scenario.renovated") : v.scenario.name,
          })),
        ]}
        onChange={(v) => {
          setViewScenario(v === "current" ? null : v);
        }}
      />
      <EnergyChangeNote building={building} current={current} />
      <CustomFieldGroup label={t("energy.energyClass")}>
        <EnergyScale
          variant="panel"
          current={current}
          compare={renovated ? after : undefined}
          compareLabel={
            chosen?.scenario.id === "full-envelope" || !chosen ? undefined : chosen.scenario.name
          }
        />
      </CustomFieldGroup>
      <IsfpOverview building={shownBuilding} energy={shown} />
      <div className="grid grid-cols-2 gap-2">
        <Big
          label={t("energy.specificHeatingDemand")}
          value={num(shown.specificHeatingDemand, 0)}
          unit="kWh/(m²a)"
        />
        <Big label={t("energy.heatingDemand")} value={num(shown.heatingDemand, 0)} unit="kWh/a" />
      </div>
      <Presence show={renovated && current.heatingDemand > 0}>
        <CustomReadOnly label={t("energy.saving")} value={pct(saving)} />
      </Presence>
      <Hint>{t("energy.scenario.hint")}</Hint>
    </div>
  );
}

/** What goes into the energy balance of the variant on show, and its detailed figures. */
export function EnergyInputs() {
  const { t, language, building, current, renovated, shown, shownBuilding, scenarioId, readOnly } =
    useEnergyView();
  const { num, pct } = useNumbers(language);
  return (
    <div className="flex flex-col gap-4">
      <SupplySection
        building={building}
        current={current}
        shownBuilding={shownBuilding}
        shown={shown}
        compare={renovated}
        scenarioId={scenarioId}
        readOnly={readOnly}
      />
      <ConsumptionSection building={building} current={current} />

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <CustomReadOnly
          label={t("energy.transmissionLoss")}
          value={`${num(shown.transmissionLoss)} W/K`}
        />
        <CustomReadOnly
          label={t("energy.solarGains")}
          value={`${num(shown.solarGains, 0)} kWh/a`}
        />
        <CustomReadOnly
          label={t("energy.internalGains")}
          value={`${num(shown.internalGains, 0)} kWh/a`}
        />
        <CustomReadOnly
          label={t("bridges.share")}
          value={
            shown.transmissionLoss > 0 ? pct(shown.bridgeLoss / shown.transmissionLoss) : "0 %"
          }
        />
        <CustomReadOnly
          label={t("energy.specificTransmissionLoss")}
          value={`${num(shown.specificTransmissionLoss, 2)} W/(m²K)`}
        />
        <CustomReadOnly
          label={t("energy.ventilationLoss")}
          value={`${num(shown.ventilationLoss)} W/K`}
        />
        <CustomReadOnly
          label={t("energy.envelopeArea")}
          value={formatArea(shown.envelopeArea, language)}
        />
        <CustomReadOnly
          label={t("energy.wallArea")}
          value={formatArea(shown.wallNetArea, language)}
        />
        <CustomReadOnly
          label={t("energy.windowArea")}
          value={formatArea(shown.windowArea, language)}
        />
        <CustomReadOnly label={t("energy.doorArea")} value={formatArea(shown.doorArea, language)} />
        <Presence show={shown.sharedWallArea > 0}>
          <CustomReadOnly
            label={t("energy.sharedWallArea")}
            value={formatArea(shown.sharedWallArea, language)}
          />
        </Presence>
        <CustomReadOnly label={t("energy.windowToWall")} value={pct(shown.windowToWallRatio)} />
        <CustomReadOnly
          label={t("energy.referenceArea")}
          value={formatArea(shown.referenceArea, language)}
        />
        <CustomReadOnly
          label={t("energy.heatedFloorArea")}
          value={formatArea(shown.heatedFloorArea, language)}
        />
        <CustomReadOnly label={t("energy.heatedVolume")} value={`${num(shown.heatedVolume)} m³`} />
      </div>

      <HeatLoads building={shownBuilding} />
      <MethodSection building={shownBuilding} summary={shown} disabled={renovated} />
      <Orientations summary={shown} />
      <AreaListSection building={shownBuilding} energy={shown} />
      <Zones summary={shown} />
      <Presence show={!renovated}>
        <AgeDefaultsSection building={building} />
      </Presence>
      <Assignments building={shownBuilding} scenarioId={scenarioId} readOnly={readOnly} />
      <GegCheck building={shownBuilding} />
      <Constructions />
      <Hint>{t("energy.assumptions")}</Hint>
    </div>
  );
}

/** Results and inputs one under the other, for a narrow column. */
export function EnergyPanel() {
  return (
    <div className="flex flex-col gap-4">
      <EnergyResults />
      <EnergyInputs />
    </div>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <Card inset className="px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display text-xl font-semibold text-ink">{value}</div>
      <div className="font-num text-xs text-muted">{unit}</div>
    </Card>
  );
}

function HeatLoads({ building }: { building: Building }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const loads = useMemo(() => roomHeatLoads(building), [building]);
  if (loads.length === 0) return null;
  const total = loads.reduce((s, l) => s + l.load, 0);
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("hvac.title")}</span>
      <Hint>{t("hvac.design", { outside: DESIGN_OUTDOOR_TEMPERATURE })}</Hint>
      {/* Grouped by storey: rooms on different storeys often share a name ("Room 1"). */}
      {building.storeys.map((storey) => {
        const here = loads.filter((l) => l.storeyId === storey.id);
        if (here.length === 0) return null;
        return (
          <div key={storey.id} className="flex flex-col gap-1">
            <span className="mt-1 text-xs font-medium text-ink">{storey.name}</span>
            {here.map((l) => (
              <div key={l.roomId} className="flex items-baseline justify-between gap-2 text-xs">
                <span
                  className={l.installed > 0 && l.coverage < 0.9 ? "text-mark" : "text-muted"}
                  title={l.installed > 0 && l.coverage < 0.9 ? t("hvac.underSized") : undefined}
                >
                  {l.name}
                </span>
                <span className="font-num text-ink">
                  {formatNumber(l.load, language, 0)} W
                  {l.installed > 0
                    ? ` · ${formatNumber(l.installed, language, 0)} W (${formatNumber(l.coverage * 100, language, 0)} %)`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      <CustomReadOnly
        label={t("hvac.total")}
        value={`${formatNumber(total / 1000, language, 1)} kW`}
      />
      <CustomReadOnly
        label={t("hvac.pumpSuggestion")}
        value={`${formatNumber(suggestHeatPumpPower(building), language, 1)} kW`}
      />
      <PumpReadiness building={building} />
    </div>
  );
}

/** The flow temperature test: can a heat pump heat this building with its radiators? */
function PumpReadiness({ building }: { building: Building }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const r = useMemo(() => heatPumpReadiness(building), [building]);
  const num = (v: number, d = 0) => formatNumber(v, language, d);
  if (r.rooms.length === 0) {
    return <Hint>{t("pump.noRadiators")}</Hint>;
  }
  const ok = r.flow !== null && r.flow <= HEAT_PUMP_FLOW;
  const short = r.rooms.filter((x) => x.flow === null || x.flow > HEAT_PUMP_FLOW);
  return (
    <Card inset className="mt-2 flex flex-col gap-1.5 p-3">
      <span className="text-xs font-semibold text-ink">{t("pump.title")}</span>
      <CustomReadOnly
        label={t("pump.flow")}
        value={r.flow === null ? t("pump.over90") : `${num(r.flow, 0)} °C`}
      />
      <span className={cx("text-xs font-medium", ok ? "text-ok" : "text-mark")}>
        {ok
          ? t("pump.ready", { flow: HEAT_PUMP_FLOW })
          : t("pump.notReady", { flow: HEAT_PUMP_FLOW })}
      </span>
      <CustomReadOnly
        label={t("pump.rooms", { flow: HEAT_PUMP_FLOW })}
        value={`${num(r.ready)} / ${num(r.rooms.length)}`}
      />
      {short.map((room) => (
        <div key={room.roomId} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-mark">{room.name}</span>
          <span className="font-num text-ink">
            {t("pump.needs", { needed: num(room.neededRated), has: num(room.installed) })}
          </span>
        </div>
      ))}
      <Presence show={r.withoutRadiator > 0}>
        <Hint>{t("pump.without", { n: r.withoutRadiator })}</Hint>
      </Presence>
      <Hint>{t("pump.hint")}</Hint>
    </Card>
  );
}

function Orientations({ summary }: { summary: EnergySummary }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const totals: Record<Orientation, { wall: number; window: number }> = {
    N: { wall: 0, window: 0 },
    E: { wall: 0, window: 0 },
    S: { wall: 0, window: 0 },
    W: { wall: 0, window: 0 },
  };
  for (const s of summary.storeys) {
    for (const o of ["N", "E", "S", "W"] as const) {
      totals[o].wall += s.windowToWall[o].wall;
      totals[o].window += s.windowToWall[o].window;
    }
  }
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("energy.byOrientation")}</span>
      {(["N", "E", "S", "W"] as const).map((o) => {
        const b = totals[o];
        const ratio = b.wall > 0 ? b.window / b.wall : 0;
        return (
          <CustomReadOnly
            key={o}
            label={t(`orientation.${o}`)}
            value={`${formatArea(b.window, language)} (${formatNumber(ratio * 100, language, 0)} %)`}
          />
        );
      })}
    </div>
  );
}

function Zones({ summary }: { summary: EnergySummary }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const zones = useEditorStore((s) => s.building.zones);
  if (summary.zones.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("energy.byZone")}</span>
      {summary.zones.map((z) => {
        const zone = zones.find((x) => x.id === z.zoneId);
        return (
          <div
            key={z.zoneId ?? "none"}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="flex items-center gap-1.5 text-muted">
              {zone && (
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: zone.color }}
                />
              )}
              {zone?.name ?? t("zone.none")}
            </span>
            <span className="font-num text-ink">
              {formatArea(z.floorArea, language)} · {formatNumber(z.transmissionLoss, language, 1)}{" "}
              W/K
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The construction of each element type: the building's, or the shown scenario's. */
function Assignments({
  building,
  scenarioId,
  readOnly,
}: {
  building: Building;
  scenarioId: string | null;
  readOnly: boolean;
}) {
  const t = useT();
  const assignConstruction = useEditorStore((s) => s.assignConstruction);
  const updateScenario = useEditorStore((s) => s.updateScenario);
  const scenarios = useEditorStore((s) => s.building.scenarios);
  const assign = (target: ConstructionTarget, category: ConstructionCategory, id: string) => {
    const scenario = scenarios?.find((sc) => sc.id === scenarioId);
    if (scenario)
      updateScenario(scenario.id, { overrides: { ...scenario.overrides, [category]: id } });
    else assignConstruction(target, id);
  };
  const options = (category: ConstructionCategory) =>
    building.constructions
      .filter((c) => c.category === category)
      .map((c) => ({ value: c.id, label: c.name, detail: String(c.uValue) }));
  const rows: {
    label: MessageKey;
    target: ConstructionTarget;
    category: ConstructionCategory;
    value: string;
  }[] = [
    {
      label: "energy.wallConstruction",
      target: { kind: "wall" },
      category: "wall",
      value: building.wallConstructionId,
    },
    {
      label: "energy.floorConstruction",
      target: { kind: "floor" },
      category: "floor",
      value: building.floorConstructionId,
    },
    {
      label: "energy.roofConstruction",
      target: { kind: "roof" },
      category: "roof",
      value: building.roofConstructionId,
    },
    {
      label: "energy.windowDefault",
      target: { kind: "window" },
      category: "window",
      value: building.windowConstructionId,
    },
    {
      label: "energy.doorDefault",
      target: { kind: "door" },
      category: "door",
      value: building.doorConstructionId,
    },
  ];
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      {rows.map((r) => (
        <CustomSelect
          key={r.label}
          label={t(r.label)}
          value={r.value}
          options={options(r.category)}
          disabled={readOnly}
          onChange={(id) => {
            assign(r.target, r.category, id);
          }}
        />
      ))}
    </div>
  );
}

const categoryLabel: Record<ConstructionCategory, MessageKey> = {
  wall: "energy.wallConstruction",
  roof: "energy.roofConstruction",
  floor: "energy.floorConstruction",
  window: "energy.windowDefault",
  door: "energy.doorDefault",
};

/** Every assigned construction against the GEG Annex 7 limit, pass or fail. */
function GegCheck({ building }: { building: Building }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const checks = gegChecks(building);
  const passed = gegPassCount(checks);
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{t("geg.title")}</span>
        <span
          className={cx(
            "rounded-control px-2.5 py-0.5 font-num text-xs font-semibold",
            passed === checks.length ? "bg-ok-soft text-ok" : "bg-mark-soft text-mark",
          )}
        >
          {t("geg.passed", { n: passed, total: checks.length })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {checks.map((c) => (
          <li
            key={c.category}
            className="flex items-center justify-between gap-2 rounded-inner bg-paper px-3 py-1.5 text-sm"
          >
            <span className="min-w-0 truncate">{t(categoryLabel[c.category])}</span>
            <span className="flex items-center gap-2 font-num text-xs text-muted">
              <span>
                {Number.isFinite(c.uValue) ? formatNumber(c.uValue, language, 2) : "?"} /{" "}
                {formatNumber(c.limit, language, 2)}
              </span>
              <span
                className={cx(
                  "rounded-control px-2 py-0.5 font-semibold",
                  c.ok ? "bg-ok-soft text-ok" : "bg-mark-soft text-mark",
                )}
              >
                {t(c.ok ? "geg.pass" : "geg.fail")}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Hint>{t("geg.hint")}</Hint>
    </div>
  );
}

function Constructions() {
  const t = useT();
  const constructions = useEditorStore((s) => s.building.constructions);
  return (
    <details className="border-t border-line pt-3">
      <summary className="text-xs font-medium text-muted select-none">
        {t("energy.constructions")}
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        {constructions.map((c) => (
          <LayerEditor key={c.id} construction={c} />
        ))}
      </div>
    </details>
  );
}

/** Construction picker for one opening or the wall, with the resulting U·A. */
export function ConstructionSelect({
  category,
  value,
  area,
  target,
}: {
  category: ConstructionCategory;
  value: string;
  area: number;
  target: ConstructionTarget;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const constructions = useEditorStore((s) => s.building.constructions);
  const assign = useEditorStore((s) => s.assignConstruction);
  const chosen =
    constructions.find((c) => c.id === value) ?? bestInCategory(constructions, category);
  return (
    <>
      <CustomSelect
        label={t("energy.construction")}
        value={value}
        options={constructions
          .filter((c) => c.category === category)
          .map((c) => ({ value: c.id, label: c.name, detail: String(c.uValue) }))}
        onChange={(id) => {
          assign(target, id);
        }}
      />
      <CustomReadOnly
        label={t("energy.elementLoss")}
        value={`${formatNumber((chosen?.uValue ?? 0) * area, language, 2)} W/K`}
      />
    </>
  );
}
