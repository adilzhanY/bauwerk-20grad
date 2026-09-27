import { useMemo } from "react";
import { bestInCategory } from "@/geometry/constructions";
import { computeEnergy } from "@/geometry/energy";
import { EnergyScale } from "./EnergyScale";
import { applyScenario, evaluateAll } from "@/geometry/scenarios";
import { gegChecks, gegPassCount } from "@/geometry/geg";
import { cx } from "@/components/cx";
import type { EnergySummary, Orientation } from "@/geometry/energy";
import type { Building, ConstructionCategory } from "@/geometry/types";
import type { BridgeType } from "@/geometry/bridges";
import { DESIGN_OUTDOOR_TEMPERATURE, roomHeatLoads, suggestHeatPumpPower } from "@/geometry/hvac";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatArea, formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import type { ConstructionTarget } from "@/store/building";
import { CustomReadOnly } from "@/components/CustomField";
import { CustomSegmented } from "@/components/CustomSegmented";
import { CustomSelect } from "@/components/CustomSelect";
import { LayerEditor } from "./LayerEditor";

export function EnergyPanel() {
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

  const num = (v: number, digits = 1) => formatNumber(v, language, digits);
  const pct = (v: number) => `${num(v * 100, 0)} %`;

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
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">{t("energy.energyClass")}</span>
        <EnergyScale
          variant="panel"
          current={current}
          compare={renovated ? after : undefined}
          compareLabel={
            chosen?.scenario.id === "full-envelope" || !chosen ? undefined : chosen.scenario.name
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Big
          label={t("energy.specificHeatingDemand")}
          value={num(shown.specificHeatingDemand, 0)}
          unit="kWh/(m²a)"
        />
        <Big label={t("energy.heatingDemand")} value={num(shown.heatingDemand, 0)} unit="kWh/a" />
      </div>
      {renovated && current.heatingDemand > 0 && (
        <CustomReadOnly label={t("energy.saving")} value={pct(saving)} />
      )}
      <p className="text-xs leading-relaxed text-muted">{t("energy.scenario.hint")}</p>

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
        <CustomReadOnly label={t("bridges.loss")} value={`${num(shown.bridgeLoss)} W/K`} />
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
        {shown.sharedWallArea > 0 && (
          <CustomReadOnly
            label={t("energy.sharedWallArea")}
            value={formatArea(shown.sharedWallArea, language)}
          />
        )}
        <CustomReadOnly label={t("energy.windowToWall")} value={pct(shown.windowToWallRatio)} />
        <CustomReadOnly
          label={t("energy.heatedFloorArea")}
          value={formatArea(shown.heatedFloorArea, language)}
        />
        <CustomReadOnly label={t("energy.heatedVolume")} value={`${num(shown.heatedVolume)} m³`} />
      </div>

      <HeatLoads building={shownBuilding} />
      <Bridges summary={shown} detail={shownBuilding.bridgeDetail ?? "poor"} disabled={renovated} />
      <Orientations summary={shown} />
      <Zones summary={shown} />
      <Assignments />
      <GegCheck />
      <Constructions />
      <p className="text-xs leading-relaxed text-muted">{t("energy.assumptions")}</p>
    </div>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-inner border border-line bg-paper px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-display text-xl font-semibold text-ink">{value}</div>
      <div className="font-num text-xs text-muted">{unit}</div>
    </div>
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
      <p className="text-xs text-muted">
        {t("hvac.design", { outside: DESIGN_OUTDOOR_TEMPERATURE })}
      </p>
      {loads.map((l) => (
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
      <CustomReadOnly
        label={t("hvac.total")}
        value={`${formatNumber(total / 1000, language, 1)} kW`}
      />
      <CustomReadOnly
        label={t("hvac.pumpSuggestion")}
        value={`${formatNumber(suggestHeatPumpPower(building), language, 1)} kW`}
      />
    </div>
  );
}

const bridgeTypeKey: Record<BridgeType, MessageKey> = {
  corner: "bridges.type.corner",
  opening: "bridges.type.opening",
  slabEdge: "bridges.type.slabEdge",
  roofEdge: "bridges.type.roofEdge",
  floorJoint: "bridges.type.floorJoint",
  junction: "bridges.type.junction",
};

function Bridges({
  summary,
  detail,
  disabled,
}: {
  summary: EnergySummary;
  detail: "good" | "poor";
  disabled: boolean;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const setBridgeDetail = useEditorStore((s) => s.setBridgeDetail);
  const types = (Object.keys(summary.bridges.lengths) as BridgeType[]).filter(
    (k) => summary.bridges.lengths[k] > 0,
  );
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("bridges.title")}</span>
      <CustomSegmented
        label={t("bridges.detail")}
        value={detail}
        disabled={disabled}
        options={[
          { value: "poor", label: t("bridges.poor") },
          { value: "good", label: t("bridges.good") },
        ]}
        onChange={setBridgeDetail}
      />
      {types.map((k) => (
        <CustomReadOnly
          key={k}
          label={t(bridgeTypeKey[k])}
          value={`${formatNumber(summary.bridges.lengths[k], language, 1)} m · ${formatNumber(summary.bridges.losses[k], language, 1)} W/K`}
        />
      ))}
    </div>
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

function Assignments() {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const assign = useEditorStore((s) => s.assignConstruction);
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
          onChange={(id) => {
            assign(r.target, id);
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
function GegCheck() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
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
      <p className="text-xs text-muted">{t("geg.hint")}</p>
    </div>
  );
}

function Constructions() {
  const t = useT();
  const constructions = useEditorStore((s) => s.building.constructions);
  return (
    <details className="border-t border-line pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted select-none">
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
