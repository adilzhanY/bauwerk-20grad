import { de } from "./de";
import { en } from "./en";
import type { MessageKey, Messages } from "./en";

export type Language = "en" | "de";
export type { MessageKey };

export const LANGUAGES: readonly Language[] = ["en", "de"];

const messages: Record<Language, Messages> = { en, de };

export type Params = Record<string, string | number>;

/** Looks up a message and fills `{name}` placeholders. A missing key is a compile error. */
export function translate(language: Language, key: MessageKey, params?: Params): string {
  const text = messages[language][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

/** Default storey names: ground floor first, then numbered upper floors. */
export function defaultStoreyName(index: number, language: Language): string {
  if (language === "de") {
    return index === 0 ? "Erdgeschoss" : `${index}. Obergeschoss`;
  }
  if (index === 0) return "Ground floor";
  return `${ordinal(index)} floor`;
}

/** Default room names, numbered from 1. */
export function defaultRoomName(index: number, language: Language): string {
  return language === "de" ? `Raum ${index}` : `Room ${index}`;
}

/** A room still called by its number ("Room 3", "Raum 3"), in either language: not named yet. */
export function isDefaultRoomName(name: string): boolean {
  return /^(Room|Raum) \d+$/.test(name.trim());
}

export function detectLanguage(): Language {
  const tag = typeof navigator === "undefined" ? "en" : navigator.language;
  return tag.toLowerCase().startsWith("de") ? "de" : "en";
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
