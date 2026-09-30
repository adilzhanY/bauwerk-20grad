import type { Language } from "@/i18n";

const locale = (language: Language) => (language === "de" ? "de-DE" : "en-GB");

export interface FormatNumberOptions {
  /** Group thousands ("1.800" in German, "1,800" in English). Off for editable inputs. */
  useGrouping?: boolean;
  /** Always show `digits` decimals ("3,50" rather than "3,5"), for columns and measurements. */
  fixed?: boolean;
}

export function formatNumber(
  value: number,
  language: Language,
  digits = 2,
  options: FormatNumberOptions = {},
): string {
  return new Intl.NumberFormat(locale(language), {
    minimumFractionDigits: options.fixed ? digits : 0,
    maximumFractionDigits: digits,
    useGrouping: options.useGrouping ?? true,
  }).format(value);
}

export const formatMetres = (value: number, language: Language): string =>
  `${formatNumber(value, language, 2)} m`;

/**
 * A dimension figure as German construction drawings write it (DIN 1356): no unit, below one
 * metre in centimetres ("76"), from one metre in metres with two decimals ("3,51"), and a
 * half centimetre as a raised 5 ("1,01⁵"). Rounded to the half centimetre.
 */
export function formatBaumass(value: number, language: Language): string {
  const halves = Math.round(value * 200);
  const cm = Math.floor(halves / 2);
  const half = halves % 2 === 1 ? "\u2075" : "";
  if (cm < 100) return `${String(cm)}${half}`;
  return `${formatNumber(cm / 100, language, 2, { fixed: true })}${half}`;
}

export const formatArea = (value: number, language: Language): string =>
  `${formatNumber(value, language, 2)} m²`;

/**
 * Parses a number typed or displayed in the locale's format. Group separators are
 * removed ("1.800" in German, "1,800" in English), then the locale's decimal mark is
 * turned into a dot. Without a language both comma and dot are read as the decimal mark.
 */
export function parseNumber(text: string, language?: Language): number | null {
  let normalised = text.trim().replace(/\s/g, "");
  if (language === "de") {
    if (normalised.includes(",")) normalised = normalised.replace(/\./g, "").replace(",", ".");
  } else if (language === "en") {
    normalised = normalised.includes(".")
      ? normalised.replace(/,/g, "")
      : normalised.replace(",", ".");
  } else {
    normalised = normalised.replace(",", ".");
  }
  if (normalised === "") return null;
  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** "2 hours ago", "gestern": how long ago `iso` was, in the language's own words. */
export function formatRelative(iso: string, language: Language, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(language), { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let size = 1;
  for (const [u, s] of steps) {
    if (Math.abs(seconds) >= s) {
      unit = u;
      size = s;
    }
  }
  return unit === "second" ? rtf.format(0, "minute") : rtf.format(Math.round(seconds / size), unit);
}
