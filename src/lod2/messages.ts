/**
 * The survey's sentences and code list labels in the UI language. lod2-core writes each note
 * as message keys with values next to the German text (lod2-core/survey/messages.ts); these
 * read the keys, so a note follows the language even after it is switched. A building saved
 * before the keys existed, or a key this version does not know, shows the stored note.
 */
import {
  buildingFunctionCodes,
  buildingFunctionLabel,
  buildingFunctionLabelEn,
  roofTypeLabel,
  roofTypeLabelEn,
} from "lod2-core/codelists";
import type { ValueSource } from "@/geometry/types";
import { en } from "@/i18n/en";
import { translate } from "@/i18n";
import type { Language, MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";

const isKey = (key: unknown): key is MessageKey =>
  typeof key === "string" && key.startsWith("survey.") && Object.hasOwn(en, key);

/** An AdV roof form code as a label, "Satteldach" or "Gable roof". */
export function roofTypeName(code: string | null | undefined, language: Language): string | null {
  return language === "de" ? roofTypeLabel(code) : roofTypeLabelEn(code);
}

/** An ALKIS building function code as a label, "Wohnhaus" or "House". */
export function buildingFunctionName(
  code: string | null | undefined,
  language: Language,
): string | null {
  return language === "de" ? buildingFunctionLabel(code) : buildingFunctionLabelEn(code);
}

/** An age class id of lod2-core as a label, "bis 1918" or "up to 1918". */
export function ageClassName(id: string, language: Language): string {
  const key = `survey.ageClass.${id}`;
  return isKey(key) ? translate(language, key) : id;
}

function value(name: string, raw: string | number, language: Language, numbers: Language): string {
  if (name === "roofType")
    return roofTypeName(String(raw), language) ?? translate(language, "survey.roof.unknownType");
  if (name === "ageClass") return ageClassName(String(raw), language);
  return typeof raw === "number" ? formatNumber(raw, numbers, 2) : raw;
}

/**
 * One message in the language, or null when it is not a survey message this version knows.
 * `numbers` picks the decimal mark, for the report, which writes numbers the German way.
 */
export function surveyText(
  message: unknown,
  language: Language,
  numbers: Language = language,
): string | null {
  if (typeof message !== "object" || message === null) return null;
  // Read as unknown: the message comes from a stored or imported file.
  const { key, values } = message as { key?: unknown; values?: unknown };
  if (!isKey(key)) return null;
  const params: Record<string, string> = {};
  if (typeof values === "object" && values !== null) {
    for (const [name, raw] of Object.entries(values as Record<string, unknown>)) {
      if (typeof raw === "string" || typeof raw === "number")
        params[name] = value(name, raw, language, numbers);
    }
  }
  return translate(language, key, params);
}

/** The note of a source in the language, the stored note when its keys cannot be read. */
export function sourceNoteText(
  source: ValueSource,
  language: Language,
  numbers: Language = language,
): string | null {
  const messages: unknown = source.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const parts = messages.map((m) => surveyText(m, language, numbers));
    if (parts.every((p) => p !== null)) return parts.join("; ");
  }
  return source.note ?? null;
}

const CONSTRUCTION_KEYS = (Object.keys(en) as MessageKey[]).filter((key) =>
  key.startsWith("survey.construction."),
);

/**
 * A construction name the survey wrote ("Vollziegel über 30 cm, ungedämmt") in the language,
 * found by its text in either language. Any other name stays as it is.
 */
export function surveyConstructionName(name: string, language: Language): string {
  const key = CONSTRUCTION_KEYS.find(
    (k) => translate("en", k) === name || translate("de", k) === name,
  );
  return key ? translate(language, key) : name;
}

/**
 * The survey names a building by its use and its id, "Wohnhaus DEBE02YY40000BOo". That name in
 * the language ("House DEBE02YY40000BOo"); a name the user gave stays as it is.
 */
export function surveyBuildingName(name: string, language: Language): string {
  const match = /^(.+) (DE[A-Z]{2}\w+)$/.exec(name);
  const use = match?.[1];
  const gid = match?.[2];
  if (!use || !gid) return name;
  if (use === translate("en", "survey.building") || use === translate("de", "survey.building"))
    return `${translate(language, "survey.building")} ${gid}`;
  const code = Object.keys(buildingFunctionCodes).find(
    (c) => buildingFunctionLabel(c) === use || buildingFunctionLabelEn(c) === use,
  );
  return code ? `${buildingFunctionName(code, language) ?? use} ${gid}` : name;
}
