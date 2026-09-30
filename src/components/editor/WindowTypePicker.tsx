import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { useState } from "react";
import { WINDOW_TYPES, windowType } from "@/geometry/windows";
import { TMA_U } from "@/geometry/subsidy";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import type { WindowScope } from "@/store/building";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";

type Reach = "one" | "wall" | "storey" | "building";

/**
 * Change windows the way a consultant does on site: pick the type found (or planned), and
 * how far it reaches: this window, the whole facade, the storey, or the whole building.
 */
export function WindowTypePicker({
  storeyId,
  openingId,
  wallIndex,
  currentId,
}: {
  storeyId: string;
  /** The window selected; without one the picker starts at the facade. */
  openingId?: string;
  wallIndex: number;
  /** The construction the selected window has now. */
  currentId?: string;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const replaceWindows = useEditorStore((s) => s.replaceWindows);
  const [reach, setReach] = useState<Reach>(openingId ? "one" : "wall");
  const num = (v: number) => formatNumber(v, language, 2);

  const scope = (): WindowScope => {
    switch (reach) {
      case "one":
        return openingId
          ? { kind: "opening", storeyId, id: openingId }
          : { kind: "wall", wallIndex };
      case "wall":
        return { kind: "wall", wallIndex };
      case "storey":
        return { kind: "storey", storeyId };
      case "building":
        return { kind: "building" };
    }
  };

  const current = currentId ? windowType(currentId) : undefined;
  return (
    <Card inset className="flex flex-col gap-2 p-3">
      <span className="text-xs font-semibold text-ink">{t("windows.title")}</span>
      <CustomSegmented
        label={t("windows.reach")}
        value={reach}
        options={[
          ...(openingId ? [{ value: "one" as const, label: t("windows.one") }] : []),
          { value: "wall" as const, label: t("windows.wall") },
          { value: "storey" as const, label: t("windows.storey") },
          { value: "building" as const, label: t("windows.building") },
        ]}
        onChange={setReach}
      />
      <CustomSelect
        label={t("windows.type")}
        value={current && reach === "one" ? current.id : ""}
        options={[
          ...(current && reach === "one" ? [] : [{ value: "", label: t("windows.choose") }]),
          ...WINDOW_TYPES.map((w) => ({
            value: w.id,
            label: `${w[language]} · ${w.era[language]}`,
            detail: `Uw ${num(w.uValue)}`,
          })),
        ]}
        onChange={(id) => {
          if (id) replaceWindows(scope(), id);
        }}
      />
      <Hint>{t("windows.hint", { limit: num(TMA_U.window) })}</Hint>
    </Card>
  );
}
