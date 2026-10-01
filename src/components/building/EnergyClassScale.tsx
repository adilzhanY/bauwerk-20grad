import type { EnergyClass } from "@/geometry/energy";
import { ENERGY_CLASS_COLORS } from "@/geometry/energy";
import { ENERGY_CLASS_INK, ENERGY_CLASS_ORDER } from "@/lib/energyClassInk";

/** The one palette of the site (geometry/energy.ts), in the certificate's order. */
const ENERGY_CLASSES = ENERGY_CLASS_ORDER.map((id) => ({ id, color: ENERGY_CLASS_COLORS[id] }));

/**
 * The energy certificate scale: a green to red band with the class letters under it, and
 * the building's class as a coloured tag sitting on the band.
 */
export function EnergyClassScale({ value, label }: { value: EnergyClass; label: string }) {
  const index = Math.max(
    0,
    ENERGY_CLASSES.findIndex((c) => c.id === value),
  );
  const step = 100 / ENERGY_CLASSES.length;
  const center = index * step + step / 2;
  const gradient = `linear-gradient(90deg, ${ENERGY_CLASSES.map((c, i) => `${c.color} ${String(i * step + step / 2)}%`).join(", ")})`;
  return (
    <figure aria-label={label} className="pt-2.5">
      {/* The tag sits inside the band and is centred on it, so it stays centred whatever
          the two heights are. */}
      <div className="relative h-2 rounded-control" style={{ background: gradient }}>
        <span
          className="absolute top-1/2 flex h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-soft px-1.5 text-sm font-semibold shadow-soft"
          style={{
            left: `${String(center)}%`,
            background: ENERGY_CLASS_COLORS[value],
            color: ENERGY_CLASS_INK[value],
          }}
        >
          {value}
        </span>
      </div>
      <div
        className="mt-4 grid text-xs text-muted"
        style={{ gridTemplateColumns: `repeat(${String(ENERGY_CLASSES.length)}, 1fr)` }}
      >
        {ENERGY_CLASSES.map((c) => (
          <span key={c.id} className="text-center">
            {c.id}
          </span>
        ))}
      </div>
    </figure>
  );
}
