import { layersResistance, materialClass } from "@/geometry/layers";
import type { MaterialClass } from "@/geometry/layers";
import type { Layer } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber } from "@/lib/format";
import type { Language } from "@/i18n";

const fills: Record<MaterialClass, string> = {
  masonry: "var(--layer-masonry)",
  concrete: "var(--layer-concrete)",
  insulation: "var(--layer-insulation)",
  plaster: "var(--layer-plaster)",
  timber: "var(--layer-timber)",
  membrane: "var(--layer-membrane)",
  other: "var(--layer-other)",
};

interface Props {
  layers: readonly Layer[];
  language: Language;
  /** Draw without design tokens, for the print view. */
  plain?: boolean;
}

/**
 * Wall cross-section from outside (left) to inside (right), each layer a band at
 * its true relative thickness, hatched by material class and labelled with
 * thickness and λ. Pure SVG so it works in the panel and in the print view.
 */
export function LayerSection({ layers, language, plain = false }: Props) {
  const t = useT();
  const patternPrefix = useId().replace(/:/g, "");
  const total = layers.reduce((s, l) => s + l.thickness, 0) || 1;
  const w = 320;
  const h = 96;
  const bandTop = 18;
  const bandH = 44;
  const bands = layers.reduce<{ l: Layer; x: number; bw: number }[]>((acc, l) => {
    const prev = acc[acc.length - 1];
    const x = prev ? prev.x + prev.bw : 0;
    acc.push({ l, x, bw: (l.thickness / total) * w });
    return acc;
  }, []);
  const stroke = plain ? "#000" : "var(--ink)";
  const text = plain ? "#000" : "var(--ink)";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      role="img"
      aria-label={t("layers.title")}
      style={{ fontFamily: plain ? "Arial, Helvetica, sans-serif" : undefined }}
    >
      <defs>
        <pattern
          id={`${patternPrefix}-hatch-masonry`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke={stroke} strokeWidth="0.8" />
        </pattern>
        <pattern
          id={`${patternPrefix}-hatch-insulation`}
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <path d="M0 5 Q2.5 0 5 5 T10 5" fill="none" stroke={stroke} strokeWidth="0.8" />
        </pattern>
        <pattern
          id={`${patternPrefix}-hatch-concrete`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1.5" cy="1.5" r="0.7" fill={stroke} />
          <circle cx="4.5" cy="4.5" r="0.7" fill={stroke} />
        </pattern>
        <pattern
          id={`${patternPrefix}-hatch-timber`}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
        >
          <line x1="0" y1="4" x2="8" y2="4" stroke={stroke} strokeWidth="0.6" />
        </pattern>
      </defs>
      <text x="0" y="12" fontSize="9" fill={text}>
        {t("layers.outside")}
      </text>
      <text x={w} y="12" fontSize="9" textAnchor="end" fill={text}>
        {t("layers.inside")}
      </text>
      {bands.map(({ l, x: bx, bw }, i) => {
        const cls = materialClass(l.name, l.conductivity);
        const hatch =
          cls === "masonry" || cls === "insulation" || cls === "concrete" || cls === "timber";
        return (
          <g key={l.id}>
            <rect
              x={bx}
              y={bandTop}
              width={bw}
              height={bandH}
              fill={plain ? "#fff" : fills[cls]}
              stroke={stroke}
              strokeWidth="0.8"
            />
            {hatch && (
              <rect
                x={bx}
                y={bandTop}
                width={bw}
                height={bandH}
                fill={`url(#${patternPrefix}-hatch-${cls})`}
                stroke="none"
              />
            )}
            <text x={bx + bw / 2} y={h - 14} fontSize="8" textAnchor="middle" fill={text}>
              {formatNumber(l.thickness * 1000, language, 1)} mm
            </text>
            <text x={bx + bw / 2} y={h - 3} fontSize="7" textAnchor="middle" fill={text}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Table of the layers with d, λ and R, for the print view. */
export function LayerTable({ layers, language }: { layers: readonly Layer[]; language: Language }) {
  const t = useT();
  return (
    <table style={{ marginTop: "4pt" }}>
      <thead>
        <tr>
          <th style={{ width: "6%" }}>#</th>
          <th>{t("layers.name")}</th>
          <th className="r">d [mm]</th>
          <th className="r">λ [W/(m·K)]</th>
          <th className="r">R [m²·K/W]</th>
        </tr>
      </thead>
      <tbody>
        {layers.map((l, i) => (
          <tr key={l.id}>
            <td>{i + 1}</td>
            <td>{l.name}</td>
            <td className="r">{formatNumber(l.thickness * 1000, language, 1)}</td>
            <td className="r">{formatNumber(l.conductivity, language, 3)}</td>
            <td className="r">{formatNumber(l.thickness / l.conductivity, language, 3)}</td>
          </tr>
        ))}
        <tr>
          <td />
          <td style={{ fontWeight: "bold" }}>{t("layers.total")}</td>
          <td className="r" style={{ fontWeight: "bold" }}>
            {formatNumber(layers.reduce((s, l) => s + l.thickness, 0) * 1000, language, 1)}
          </td>
          <td />
          <td className="r" style={{ fontWeight: "bold" }}>
            {formatNumber(layersResistance(layers), language, 3)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
import { useId } from "react";
