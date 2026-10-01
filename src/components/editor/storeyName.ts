import type { Language } from "@/i18n";

/** The letters each language uses for the ground floor, a basement and an attic. */
const SHORT: Record<Language, { ground: string; basement: string; attic: string }> = {
  de: { ground: "EG", basement: "KG", attic: "DG" },
  en: { ground: "G", basement: "B", attic: "A" },
};

/**
 * The short name of a storey on the pill: the ground floor's letters (EG, G), the floor
 * number above it, and the basement's or attic's letters for a storey named as one, in the
 * interface language.
 */
export function storeyShortName(index: number, name: string, language: Language): string {
  const short = SHORT[language];
  if (/keller|basement|\bkg\b/i.test(name)) return short.basement;
  if (/dach|attic|\bdg\b/i.test(name)) return short.attic;
  return index === 0 ? short.ground : String(index);
}
