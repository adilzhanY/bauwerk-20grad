import { Hint } from "@/components/shared/Hint";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { areaList, areaListCsv } from "@/geometry/areaList";
import type { EnergySummary } from "@/geometry/energy";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { buildingFileName, downloadFile } from "@/lib/download";
import { AREA_HEADER_KEYS, DIRECTION_KEYS, ELEMENT_KEYS } from "@/lib/areaWords";

/** Makes a spreadsheet read the file as UTF-8, so the umlauts come out right. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * The thermal envelope as the table a consultant types into the calculation software:
 * element, direction, tilt, area, U, Fx and H_T, with a CSV download of the same rows.
 */
export function AreaListSection({
  building,
  energy,
}: {
  building: Building;
  energy: EnergySummary;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const rows = useMemo(() => areaList(building, energy), [building, energy]);
  const num = (v: number, d: number) => formatNumber(v, language, d, { fixed: true });

  const download = () => {
    const csv = areaListCsv(
      rows,
      {
        header: AREA_HEADER_KEYS.map((k) => t(k)),
        element: (e) => t(ELEMENT_KEYS[e]),
        direction: (d) => t(DIRECTION_KEYS[d]),
      },
      language,
    );
    downloadFile(
      BYTE_ORDER_MARK + csv,
      buildingFileName(`${building.name} ${t("areas.file")}`, "csv"),
      "text/csv",
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">{t("areas.title")}</span>
        <CustomButton variant="quiet" icon={<Download size={14} aria-hidden />} onClick={download}>
          CSV
        </CustomButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-1 text-left font-medium">{t("areas.element")}</th>
              <th className="py-1 text-left font-medium">{t("areas.direction")}</th>
              <th className="py-1 text-right font-medium">m²</th>
              <th className="py-1 text-right font-medium">U</th>
              <th className="py-1 text-right font-medium">Fx</th>
              <th className="py-1 text-right font-medium">W/K</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-1 pr-1 text-ink">
                  {t(ELEMENT_KEYS[r.element])}
                  {r.count > 0 && <span className="text-muted"> · {r.count}</span>}
                </td>
                <td className="py-1 text-muted">
                  {r.direction === null ? "" : t(DIRECTION_KEYS[r.direction])}
                  {r.element === "roof" && r.tilt > 0 ? ` ${num(r.tilt, 0)}°` : ""}
                </td>
                <td className="py-1 text-right font-num text-ink">{num(r.area, 1)}</td>
                <td className="py-1 text-right font-num text-ink">{num(r.uValue, 2)}</td>
                <td className="py-1 text-right font-num text-muted">{num(r.fx, 2)}</td>
                <td className="py-1 text-right font-num text-ink">{num(r.ht, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Hint>{t("areas.hint")}</Hint>
    </div>
  );
}
