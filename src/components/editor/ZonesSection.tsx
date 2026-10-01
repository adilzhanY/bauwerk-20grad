import { Plus } from "lucide-react";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomSection } from "@/components/shared/CustomField";
import { cx } from "@/components/shared/cx";
import { useT } from "@/i18n/useT";
import { ZONE_COLORS } from "@/lib/colors";
import { useEditorStore } from "@/store/building";

/**
 * The building's zones, under its properties: add one, pick the one the Zone tool paints
 * with, open one to rename it or change its colour.
 */
export function ZonesSection() {
  const t = useT();
  const zones = useEditorStore((s) => s.building.zones);
  const activeZoneId = useEditorStore((s) => s.activeZoneId);
  const selection = useEditorStore((s) => s.selection);
  const addZone = useEditorStore((s) => s.addZone);
  const setActiveZone = useEditorStore((s) => s.setActiveZone);
  const select = useEditorStore((s) => s.select);
  const setTool = useEditorStore((s) => s.setTool);

  const onAdd = () => {
    const used = new Set(zones.map((z) => z.color));
    const color = ZONE_COLORS.find((c) => !used.has(c)) ?? ZONE_COLORS[0];
    const id = addZone(t("zone.defaultName", { n: zones.length + 1 }), color);
    setActiveZone(id);
    select({ kind: "zone", id });
    setTool("zone");
  };

  return (
    <CustomSection
      title={t("panel.zones")}
      action={
        <CustomIconButton label={t("zone.add")} size="sm" onClick={onAdd}>
          <Plus size={16} />
        </CustomIconButton>
      }
    >
      <Presence show={zones.length === 0}>
        <Hint>{t("zone.emptyHint")}</Hint>
      </Presence>
      <ul className="-mx-2 flex flex-col">
        {zones.map((zone) => {
          const active = zone.id === activeZoneId;
          const selected = selection?.kind === "zone" && selection.id === zone.id;
          const state = t(zone.heated ? "zone.heated" : "zone.unheated");
          return (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveZone(zone.id);
                  select({ kind: "zone", id: zone.id });
                }}
                aria-pressed={selected}
                className={cx(
                  "flex h-8 w-full items-center gap-2 rounded-soft px-3 text-left text-sm transition-colors",
                  selected ? "bg-select-soft" : "hover:bg-panel",
                )}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ background: zone.color }}
                />
                <span className="flex-1 truncate text-ink">{zone.name}</span>
                {/* A zone named after its state ("Heated") needs no tag saying it again. */}
                {zone.name.trim().toLowerCase() !== state.toLowerCase() && (
                  <span className="font-num text-[11px] text-faint">{state}</span>
                )}
                {active && (
                  <span className="rounded-soft bg-select-soft px-1.5 font-num text-[11px] text-select">
                    {t("zone.active")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </CustomSection>
  );
}
