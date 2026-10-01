import { SectionLabel } from "@/components/shared/PageTitle";
import { ageClassName, buildingFunctionName, roofTypeName } from "@/lod2/messages";
import type { EnergySummary } from "@/geometry/energy";
import { Hint } from "@/components/shared/Hint";
import type { ReactNode } from "react";
import type { BuildingDetail } from "lod2-core/api";
import { AGE_CLASSES, ageClassById } from "lod2-core/survey";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import type { BuildingAnalysis } from "@/lod2/analysis";
import type { BuildingSurvey } from "@/lod2/state/survey";
import { useSurvey } from "@/lod2/state/survey";
import { useEditorStore } from "@/store/building";
import { DataRow, ValueUnit } from "@/components/building/DataRow";
import { EnergyClassScale } from "@/components/building/EnergyClassScale";
import { MonthBars } from "@/components/building/MonthBars";

export function SectionTitle({ children }: { children: ReactNode }) {
  return <SectionLabel className="mt-10 mb-3">{children}</SectionLabel>;
}

/**
 * "Energiedaten unsanierter Zustand": the class, demand, heat load and the PV potential. With
 * this building's project open, the class and demand are the project's model as it is now
 * (`live`), the same numbers as the project bar above, not the first estimate from LoD2.
 */
export function EnergySection({
  analysis,
  live,
}: {
  analysis: BuildingAnalysis;
  live?: EnergySummary | null;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const n = (v: number, digits = 1) => formatNumber(v, language, digits);
  const { heatLoad, pv } = analysis;
  const energy = live ?? analysis.energy;
  const area = Math.max(1e-9, energy.heatedFloorArea);
  return (
    <section>
      <SectionTitle>{t("building.energyTitle")}</SectionTitle>
      <EnergyClassScale value={energy.energyClass} label={t("energy.energyClass")} />
      <div className="mt-6">
        <DataRow label={t("building.heatingDemand")} info={t("building.heatingDemandInfo")}>
          <ValueUnit value={n(energy.heatingDemand, 0)} unit="kWh/a" />
        </DataRow>
        <DataRow label={t("building.specificDemand")} info={t("building.specificDemandInfo")}>
          <ValueUnit value={n(energy.specificHeatingDemand)} unit="kWh/(m²·a)" />
        </DataRow>
        <DataRow label={t("building.heatLoad")} info={t("building.heatLoadInfo")}>
          <ValueUnit value={n(heatLoad / 1000)} unit="kW" />
        </DataRow>
        <DataRow label={t("building.specificHeatLoad")} info={t("building.specificHeatLoadInfo")}>
          <ValueUnit value={n(heatLoad / area)} unit="W/m²" />
        </DataRow>
        <DataRow label={t("building.pvPotential")} info={t("building.pvInfo")}>
          <ValueUnit value={n(pv.peakPower)} unit="kWp" />
        </DataRow>
        <DataRow label={t("building.pvYield")} info={t("building.pvYieldInfo")}>
          <ValueUnit value={n(pv.yearlyYield, 0)} unit={t("building.kwhPerYear")} />
        </DataRow>
        <DataRow label={t("building.usableRoof")} info={t("building.usableRoofInfo")}>
          <ValueUnit value={n(pv.usableArea, 0)} unit="m²" />
        </DataRow>
        <DataRow label={t("building.monthlyYield")} info={t("building.monthlyYieldInfo")}>
          <MonthBars values={pv.monthlyYield} label={t("building.monthlyYield")} />
        </DataRow>
      </div>
    </section>
  );
}

/** "Allgemeine Gebäudedaten": use, construction year, storeys, sizes, heights, the id. */
export function GeneralSection({
  detail,
  partGid,
  analysis,
  survey,
}: {
  detail: BuildingDetail;
  partGid: string | null;
  analysis: BuildingAnalysis;
  survey: BuildingSurvey;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const setFacts = useSurvey((s) => s.setFacts);
  const n = (v: number | null | undefined, digits = 1) =>
    v == null ? "-" : formatNumber(v, language, digits);
  const part = detail.parts.find((p) => p.gid === partGid);
  const { energy, building, report } = analysis;
  const age = ageClassById(survey.facts.ageClass);
  return (
    <section>
      <SectionTitle>{t("building.generalTitle")}</SectionTitle>
      <DataRow label={t("building.use")}>
        {buildingFunctionName(detail.functionCode, language) ?? detail.functionLabel ?? "-"}
      </DataRow>
      <DataRow label={t("building.roofForm")}>
        {roofTypeName(part?.roofTypeCode ?? detail.roofTypeCode, language) ??
          part?.roofTypeLabel ??
          detail.roofTypeLabel ??
          "-"}
      </DataRow>
      <DataRow label={t("building.ageClass")} info={t("building.ageClassInfo")}>
        <select
          aria-label={t("building.ageClass")}
          value={age.id}
          onChange={(e) => {
            const next = AGE_CLASSES.find((c) => c.id === e.target.value);
            if (next) setFacts(detail.buildingGid, { ageClass: next.id, ageClassConfirmed: true });
          }}
          className="rounded-soft bg-transparent text-right font-medium text-ink hover:bg-paper"
        >
          {AGE_CLASSES.map((c) => (
            <option key={c.id} value={c.id}>
              {ageClassName(c.id, language)}
            </option>
          ))}
        </select>
      </DataRow>
      <DataRow label={t("building.storeys")} info={t("building.storeysInfo")}>
        {building.storeys.length}
      </DataRow>
      <DataRow label={t("building.footprint")}>
        <ValueUnit value={n(part?.footprintArea)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.heatedArea")}>
        <ValueUnit value={n(energy.heatedFloorArea, 0)} unit="m²" />
      </DataRow>
      <DataRow label={t("energy.referenceArea")}>
        <ValueUnit value={n(energy.referenceArea, 0)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.volume")}>
        <ValueUnit value={n(part?.volume, 0)} unit="m³" />
      </DataRow>
      <DataRow label={t("building.eaveHeight")}>
        <ValueUnit value={n(report.eaveAboveStreet, 2)} unit="m" />
      </DataRow>
      <DataRow label={t("building.ridgeHeight")}>
        <ValueUnit value={n(part?.ridgeHeight, 2)} unit="m" />
      </DataRow>
      <DataRow label={t("building.windowShare")} info={t("building.windowShareInfo")}>
        {formatNumber(energy.windowToWallRatio * 100, language, 1)} %
      </DataRow>
      <DataRow label={t("building.partyWalls")}>
        <ValueUnit value={n(energy.sharedWallArea, 0)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.gid")}>
        <span className="font-num text-sm">{partGid ?? detail.buildingGid}</span>
      </DataRow>
      <DataRow label={t("building.dataDate")}>{detail.creationDate ?? "-"}</DataRow>
    </section>
  );
}

/** The plot tab: the whole building with all its parts. */
export function PlotSection({
  detail,
  parts,
}: {
  detail: BuildingDetail;
  parts: BuildingDetail["parts"];
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const n = (v: number | null | undefined, digits = 1) =>
    v == null ? "-" : formatNumber(v, language, digits);
  const totals = detail.totals;
  return (
    <section>
      <SectionTitle>{t("building.plotTitle")}</SectionTitle>
      <DataRow label={t("building.footprintTotal")}>
        <ValueUnit value={n(totals.footprintArea)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.partCount")}>{parts.length}</DataRow>
      <DataRow label={t("building.volume")}>
        <ValueUnit value={n(totals.volume, 0)} unit="m³" />
      </DataRow>
      <DataRow label={t("building.wallArea")}>
        <ValueUnit value={n(totals.wallArea, 0)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.roofArea")}>
        <ValueUnit value={n(totals.roofArea3d, 0)} unit="m²" />
      </DataRow>
      <DataRow label={t("building.ridgeHeight")}>
        <ValueUnit value={n(totals.ridgeHeight, 2)} unit="m" />
      </DataRow>
      <DataRow label={t("building.sourceTile")}>{detail.sourceTile}</DataRow>
      <DataRow label={t("building.gid")}>
        <span className="font-num text-sm">{detail.buildingGid}</span>
      </DataRow>
      <Hint className="mt-4">{detail.attribution}</Hint>
    </section>
  );
}
