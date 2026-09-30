import { useState } from "react";
import { WALL_KINDS, WINDOW_KINDS, wallKindFits, windowKindFits } from "@/geometry/ageDefaults";
import type { WallKind, WindowKind } from "@/geometry/ageDefaults";
import { roofOf } from "@/geometry/roof";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { Hint } from "@/components/shared/Hint";

const WALLS = Object.keys(WALL_KINDS) as WallKind[];
const WINDOWS = Object.keys(WINDOW_KINDS) as WindowKind[];

/**
 * A first envelope for a building nobody has measured: pick the year and the kind of wall and
 * window, and every element gets the flat U-value of its age class.
 */
export function AgeDefaultsSection({ building }: { building: Building }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const applyAgeDefaults = useEditorStore((s) => s.applyAgeDefaults);
  const [year, setYear] = useState(building.yearBuilt ?? 1950);
  const walls = WALLS.filter((k) => wallKindFits(k, year));
  const windows = WINDOWS.filter((k) => windowKindFits(k, year));
  const [wall, setWall] = useState<WallKind>("brickHollow");
  const [windowKind, setWindowKind] = useState<WindowKind>("woodDouble");
  // A kind the table has no value for in this age falls back to the first that fits.
  const wallShown = walls.includes(wall) ? wall : (walls[0] ?? "brickHollow");
  const windowShown = windows.includes(windowKind) ? windowKind : (windows[0] ?? "woodDouble");
  const roof = roofOf(building);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-medium text-muted">{t("age.title")}</span>
      <CustomNumberInput
        label={t("age.year")}
        value={year}
        min={1800}
        max={2030}
        step={1}
        language={language}
        slider={false}
        onChange={(v) => {
          setYear(Math.round(v));
        }}
      />
      <CustomSelect<WallKind>
        label={t("age.wall")}
        value={wallShown}
        options={walls.map((k) => ({ value: k, label: t(`wallKind.${k}`) }))}
        onChange={setWall}
      />
      <CustomSelect<WindowKind>
        label={t("age.window")}
        value={windowShown}
        options={windows.map((k) => ({ value: k, label: t(`windowKind.${k}`) }))}
        onChange={setWindowKind}
      />
      <CustomButton
        className="self-start"
        onClick={() => {
          applyAgeDefaults({
            year,
            wall: wallShown,
            window: windowShown,
            roofIsEnvelope: roof.kind === "flat" || roof.heatedAttic,
          });
        }}
      >
        {t("age.apply")}
      </CustomButton>
      <Hint>{t("age.hint")}</Hint>
    </div>
  );
}
