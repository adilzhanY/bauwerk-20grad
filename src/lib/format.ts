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
