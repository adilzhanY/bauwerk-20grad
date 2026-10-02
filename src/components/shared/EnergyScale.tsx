import {
  ENERGY_CLASSES,
  ENERGY_CLASS_COLORS,
  ENERGY_CLASS_UPPER,
  ENERGY_SCALE_MAX,
} from "@/geometry/energy";
import type { EnergySummary } from "@/geometry/energy";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";

const UNIT = "kWh/(m²a)";

interface Props {
  current: EnergySummary;
  /** Second marker below the band, for a scenario. */
  compare?: EnergySummary;
  compareLabel?: string;
  /** Print draws in black on white; the panel uses the theme colours. */
  variant: "panel" | "print";
}

/**
 * The coloured band of the German Energieausweis with a marker for the current
 * state above and, optionally, a scenario below. Values past 300 sit at the end.
 * The accessible name carries the class of the scenario when one is shown.
 */
export function EnergyScale({ current, compare, compareLabel, variant }: Props) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const panel = variant === "panel";
  const num = (v: number) =>
    variant === "print" ? formatNumber(v, "de", 0) : formatNumber(v, language, 0);
  const w = panel ? 400 : 560;
  const h = compare ? (panel ? 112 : 82) : panel ? 82 : 60;
  const barY = panel ? 34 : 26;
  const barH = panel ? 24 : 18;
  const markerFont = panel ? 12 : 10;
  const classFont = panel ? 12 : 9.5;
  const tickFont = panel ? 9 : 7.5;
  const ink = variant === "print" ? "#000" : "currentColor";
  const x = (v: number) => (Math.min(v, ENERGY_SCALE_MAX) / ENERGY_SCALE_MAX) * w;
  const segments = ENERGY_CLASSES.map((c, i) => ({
    c,
    x0: x(i === 0 ? 0 : (ENERGY_CLASS_UPPER[i - 1] ?? 0)),
    x1: x(ENERGY_CLASS_UPPER[i] ?? ENERGY_SCALE_MAX),
  }));
  const ticks = [0, 50, 100, 150, 200, 250, 300];
  const marker = (v: number, label: string, above: boolean) => {
    const text = `${label}: ${num(v)}`;
    // Centred over its arrow, unless that would run past an end of the scale: then it lines
    // up with that end (values past 300, "Scenario 1: 344", sit at the right end).
    const half = (text.length * markerFont * 0.62) / 2;
    const arrowX = Math.max(5, Math.min(w - 5, x(v)));
    const anchor = arrowX + half > w ? "end" : arrowX - half < 0 ? "start" : "middle";
    const textX = anchor === "end" ? w : anchor === "start" ? 0 : arrowX;
    const y = above ? barY - 3 : barY + barH + 3;
    const dir = above ? -1 : 1;
    return (
      <g key={label}>
        <path d={`M${arrowX} ${y} l${-5} ${dir * 7} h10 z`} fill={ink} />
        <text
          x={textX}
          y={above ? y - (panel ? 12 : 10) : y + (panel ? 20 : 17)}
          fontSize={markerFont}
          fontWeight="600"
          textAnchor={anchor}
          fill={ink}
        >
          {text}
        </text>
      </g>
    );
  };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", display: "block" }}
      role="img"
      aria-label={`${t("energy.energyClass")}: ${(compare ?? current).energyClass ?? t("energy.noClass")}`}
      className={variant === "panel" ? "text-ink" : undefined}
    >
      {segments.map((s) => (
        <g key={s.c}>
          <rect
            x={s.x0}
            y={barY}
            width={s.x1 - s.x0}
            height={barH}
            fill={ENERGY_CLASS_COLORS[s.c]}
            stroke={variant === "print" ? "#000" : "none"}
            strokeWidth="0.5"
          />
          <text
            x={(s.x0 + s.x1) / 2}
            y={barY + barH - (panel ? 6 : 5)}
            fontSize={classFont}
            fontWeight="600"
            textAnchor="middle"
            fill="var(--fixed-ink)"
          >
            {s.c}
          </text>
        </g>
      ))}
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={x(v)}
            y1={barY + barH}
            x2={x(v)}
            y2={barY + barH + 3}
            stroke={ink}
            strokeWidth="0.5"
          />
          <text
            x={x(v)}
            y={h - 2}
            fontSize={tickFont}
            textAnchor={v === 0 ? "start" : v === 300 ? "end" : "middle"}
            fill={ink}
            opacity="0.7"
          >
            {/* The unit rides on the first tick, where the next one leaves room for it. */}
            {v === 0 ? `0 ${UNIT}` : v}
          </text>
        </g>
      ))}
      {marker(current.specificEndEnergy, t("energy.scenario.current"), true)}
      {compare &&
        marker(compare.specificEndEnergy, compareLabel ?? t("energy.scenario.renovated"), false)}
    </svg>
  );
}
