import { useEffect, useMemo, useState } from "react";
import { computeEnergy } from "@/geometry/energy";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { diffBuilding } from "@/sync/ops";
import { summarizeOps } from "@/sync/summary";
import { fetchVersion } from "@/sync/useSync";
import { useEditorStore } from "@/store/building";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { EnergyClassBadge } from "@/components/shared/EnergyClassBadge";
import { Hint } from "@/components/shared/Hint";
import { Spinner } from "@/components/shared/Spinner";
import { changeText } from "./changeText";

/** What the comparison counts in one building. */
function figures(building: Building) {
  const energy = computeEnergy(building);
  const storeys = building.storeys;
  return {
    energyClass: energy.energyClass,
    end: energy.specificEndEnergy,
    heating: energy.specificHeatingDemand,
    area: energy.referenceArea,
    walls: storeys.reduce((n, s) => n + s.interiorWalls.length, 0),
    openings: storeys.reduce((n, s) => n + s.openings.length, 0),
    rooms: storeys.reduce((n, s) => n + s.rooms.length, 0),
  };
}

/**
 * A version beside the building now (TODO Part 21, CG.3): the energy figures and the counts
 * that matter, and what changed between them in words.
 */
export function CompareDialog({
  version,
  name,
  onClose,
}: {
  version: number;
  name: string;
  onClose: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const now = useEditorStore((s) => s.building);
  const [then, setThen] = useState<Building | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchVersion(version)
      .then((building) => {
        if (live) setThen(building);
      })
      .catch(() => {
        // Offline or refused: the dialog says the version cannot be shown.
        if (live) setThen(null);
      });
    return () => {
      live = false;
    };
  }, [version]);

  const result = useMemo(() => {
    if (!then) return null;
    return {
      a: figures(then),
      b: figures(now),
      changed: changeText(summarizeOps(diffBuilding(then, now)), t, 8),
    };
  }, [then, now, t]);

  const num = (n: number, digits = 0) => formatNumber(n, language, digits);
  const unit = (n: number) => `${num(n)} kWh/(m²a)`;

  return (
    <CustomDialog
      title={t("compare.title")}
      closeLabel={t("compare.close")}
      onClose={onClose}
      width={560}
    >
      {then === undefined ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size="sm" />
          {t("compare.loading")}
        </div>
      ) : !result ? (
        <Hint error>{t("history.unavailable")}</Hint>
      ) : (
        <div className="flex flex-col gap-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 font-medium">{t("compare.what")}</th>
                <th className="py-1.5 font-medium">{t("compare.then", { name })}</th>
                <th className="py-1.5 font-medium">{t("compare.now")}</th>
              </tr>
            </thead>
            <tbody className="font-num">
              <tr className="border-t border-line">
                <td className="py-1.5 font-sans text-ink">{t("compare.class")}</td>
                <td>
                  <EnergyClassBadge value={result.a.energyClass} />
                </td>
                <td>
                  <EnergyClassBadge value={result.b.energyClass} />
                </td>
              </tr>
              {(
                [
                  ["compare.end", unit(result.a.end), unit(result.b.end)],
                  ["compare.heating", unit(result.a.heating), unit(result.b.heating)],
                  ["compare.area", `${num(result.a.area)} m²`, `${num(result.b.area)} m²`],
                  ["compare.walls", num(result.a.walls), num(result.b.walls)],
                  ["compare.openings", num(result.a.openings), num(result.b.openings)],
                  ["compare.rooms", num(result.a.rooms), num(result.b.rooms)],
                ] as const
              ).map(([key, a, b]) => (
                <tr key={key} className="border-t border-line">
                  <td className="py-1.5 font-sans text-ink">{t(key)}</td>
                  <td className="text-muted">{a}</td>
                  <td className={a === b ? "text-muted" : "font-semibold text-ink"}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink">
              {t("compare.changes")} {name}
            </span>
            <p className="text-sm text-muted">{result.changed || t("compare.none")}</p>
          </div>
        </div>
      )}
    </CustomDialog>
  );
}
