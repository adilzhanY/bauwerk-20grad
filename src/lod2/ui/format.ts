/** Number formats shared by the panel, the 3D caption and the photo editor, in the app's language. */
import { useCallback, useMemo } from "react";
import type { Language } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";

/** "14,33 x 14,38 m", a wall or opening size in metres with centimetre precision. */
export function formatSize(width: number, height: number, language: Language): string {
  return `${fixed(width, language, 2)} x ${fixed(height, language, 2)} m`;
}

/** "23,1 %", or "-" when there is no ratio (a wall with no area). */
export function formatRatio(ratio: number | null, language: Language): string {
  return ratio === null ? "-" : `${fixed(ratio * 100, language, 1)} %`;
}

/** A measurement with a fixed number of decimals and the language's decimal mark. */
export function fixed(value: number, language: Language, digits: number): string {
  return formatNumber(value, language, digits, { fixed: true });
}

/** The formats above, bound to the current language. */
export function useFormat() {
  const language = useEditorStore((s) => s.language);
  const num = useCallback(
    (value: number, digits: number) => fixed(value, language, digits),
    [language],
  );
  return useMemo(
    () => ({
      language,
      num,
      size: (width: number, height: number) => formatSize(width, height, language),
      ratio: (ratio: number | null) => formatRatio(ratio, language),
      area: (area: number) => `${num(area, 2)} m²`,
    }),
    [language, num],
  );
}
