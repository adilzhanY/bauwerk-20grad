import { useEffect, useState } from "react";
import { energyDelta } from "@/geometry/energyDelta";
import type { DeltaItem, DeltaKey } from "@/geometry/energyDelta";
import type { EnergySummary } from "@/geometry/energy";
import { supplyOf } from "@/geometry/supply";
import type { SupplySummary } from "@/geometry/supply";
import type { Building } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { Notice } from "@/components/shared/Notice";
import { Presence } from "@/components/shared/Presence";

/** How long the note stays after an edit. */
const SHOW_MS = 12_000;

const LABEL: Record<DeltaKey, MessageKey> = {
  referenceArea: "energy.referenceArea",
  windowArea: "energy.windowArea",
  transmissionLoss: "energy.transmissionLoss",
  endPerM2: "supply.endPerM2",
  primaryPerM2: "supply.primaryPerM2",
  co2: "change.co2",
};

const UNIT: Record<DeltaKey, string> = {
  referenceArea: "m²",
  windowArea: "m²",
  transmissionLoss: "W/K",
  endPerM2: "kWh/(m²a)",
  primaryPerM2: "kWh/(m²a)",
  co2: "kg/a",
};

interface Seen {
  buildingId: string;
  energy: EnergySummary;
  supply: SupplySummary;
}

/**
 * After every edit of the building, what it did to the balance: the figures that moved, with
 * the sign. The panel already recalculates on every change; this makes it visible. Another
 * building being opened is no edit and says nothing.
 */
export function EnergyChangeNote({
  building,
  current,
}: {
  building: Building;
  current: EnergySummary;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [seen, setSeen] = useState<Seen>(() => ({
    buildingId: building.id,
    energy: current,
    supply: supplyOf(building, current),
  }));
  const [change, setChange] = useState<{ items: DeltaItem[] } | null>(null);

  // Compared while rendering, the way React adjusts state to a changed prop.
  if (seen.energy !== current) {
    const next = { buildingId: building.id, energy: current, supply: supplyOf(building, current) };
    setSeen(next);
    const items = seen.buildingId === building.id ? energyDelta(seen, next) : [];
    setChange(items.length > 0 ? { items } : null);
  }

  useEffect(() => {
    if (!change) return;
    const timer = setTimeout(() => {
      setChange(null);
    }, SHOW_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [change]);

  const signed = (item: DeltaItem) => {
    const digits = item.key === "co2" ? 0 : item.key === "windowArea" ? 2 : 1;
    const value = formatNumber(Math.abs(item.delta), language, digits);
    return `${item.delta > 0 ? "+" : "−"}${value} ${UNIT[item.key]}`;
  };

  return (
    <Presence value={change}>
      {(c) => (
        <Notice tone="info">
          <span className="block text-xs font-semibold">{t("change.title")}</span>
          <span className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
            {c.items.map((item) => (
              <span key={item.key} className="contents">
                <span>{t(LABEL[item.key])}</span>
                <span className="text-right font-num">{signed(item)}</span>
              </span>
            ))}
          </span>
        </Notice>
      )}
    </Presence>
  );
}
