/**
 * Room names read from a floor plan. Plans name their rooms from a fairly fixed set, in German
 * or English, new or old ("Wohnzimmer", "Bad", "WC", "Stube", "Abort", "Living room"), often
 * abbreviated ("WZ", "HWR") and, on old or scanned plans, barely legible ("Kiiche", "Vorraim").
 * So every word the AI read is matched against this dictionary, forgiving a letter or two, and
 * the best match inside a room names it. Floor finishes and other plan words that look like
 * room names ("Dielen" is a floor, "Diele" a room) are recognised as such and never name a room.
 */
import type { Language } from "@/i18n";
import { pointInPolygon } from "./polygon";
import type { Vec2 } from "./types";

export interface RoomName {
  de: string;
  en: string;
  /** Other spellings, old names, abbreviations, English variants: all lower case. */
  aliases?: string[];
}

export const ROOM_NAMES: RoomName[] = [
  {
    de: "Wohnzimmer",
    en: "Living room",
    aliases: ["wohnen", "wz", "wohnraum", "wohnstube", "stube", "living", "lounge", "sitting room"],
  },
  {
    de: "Esszimmer",
    en: "Dining room",
    aliases: ["essen", "speisezimmer", "speiseraum", "dining"],
  },
  { de: "Küche", en: "Kitchen", aliases: ["kochen", "kü", "ebk", "einbauküche"] },
  {
    de: "Wohnküche",
    en: "Kitchen-diner",
    aliases: ["wohnkueche", "kitchen diner", "eat-in kitchen"],
  },
  { de: "Teeküche", en: "Kitchenette", aliases: ["pantry kitchen"] },
  {
    de: "Schlafzimmer",
    en: "Bedroom",
    aliases: [
      "schlafen",
      "sz",
      "schlafraum",
      "schlafstube",
      "eltern",
      "elternschlafzimmer",
      "bed room",
      "master bedroom",
    ],
  },
  {
    de: "Kinderzimmer",
    en: "Children's room",
    aliases: ["kind", "kinder", "kz", "kinderstube", "nursery", "kids room"],
  },
  {
    de: "Arbeitszimmer",
    en: "Study",
    aliases: ["arbeiten", "az", "herrenzimmer", "home office", "studio"],
  },
  { de: "Gästezimmer", en: "Guest room", aliases: ["gäste", "gast", "gaestezimmer"] },
  {
    de: "Bad",
    en: "Bathroom",
    aliases: ["badezimmer", "bz", "wannenbad", "duschbad", "bath", "baths"],
  },
  {
    de: "WC",
    en: "WC",
    aliases: [
      "toilette",
      "abort",
      "gäste-wc",
      "gaeste wc",
      "klo",
      "toilet",
      "lavatory",
      "restroom",
    ],
  },
  { de: "Dusche", en: "Shower room", aliases: ["du", "duschraum", "shower"] },
  { de: "Flur", en: "Hall", aliases: ["korridor", "gang", "vorflur", "corridor", "hallway"] },
  { de: "Diele", en: "Entrance hall", aliases: ["halle", "foyer"] },
  {
    de: "Hausflur",
    en: "Lobby",
    aliases: ["hauseingang", "eingang", "eingangshalle", "vestibül", "entrance", "entry"],
  },
  { de: "Vorraum", en: "Anteroom", aliases: ["vorzimmer", "windfang", "vorraumthür"] },
  {
    de: "Treppenhaus",
    en: "Stairwell",
    aliases: ["treppe", "trh", "treppenraum", "stairs", "staircase", "stair"],
  },
  {
    de: "Abstellraum",
    en: "Storage room",
    aliases: ["abstellkammer", "ar", "abst", "abstell", "storage", "store room", "closet"],
  },
  { de: "Kammer", en: "Box room", aliases: ["mädchenkammer", "maedchenkammer"] },
  {
    de: "Speisekammer",
    en: "Pantry",
    aliases: ["speis", "vorratsraum", "vorrat", "pantry", "larder"],
  },
  { de: "Hauswirtschaftsraum", en: "Utility room", aliases: ["hwr", "hauswirtschaft", "utility"] },
  { de: "Waschküche", en: "Laundry", aliases: ["waschraum", "laundry", "trockenraum"] },
  {
    de: "Ankleide",
    en: "Dressing room",
    aliases: ["ankleidezimmer", "dressing", "walk-in closet"],
  },
  {
    de: "Ladenlokal",
    en: "Shop",
    aliases: ["laden", "geschäft", "verkauf", "verkaufsraum", "shop", "store"],
  },
  { de: "Büro", en: "Office", aliases: ["office", "kontor", "contor", "comptoir", "buero"] },
  { de: "Lager", en: "Store", aliases: ["lagerraum", "warehouse"] },
  { de: "Werkstatt", en: "Workshop", aliases: ["workshop", "werkraum"] },
  {
    de: "Personalraum",
    en: "Staff room",
    aliases: ["aufenthaltsraum", "staff room", "sozialraum"],
  },
  { de: "Balkon", en: "Balcony", aliases: ["balcony"] },
  { de: "Loggia", en: "Loggia" },
  { de: "Terrasse", en: "Terrace", aliases: ["terrace"] },
  { de: "Keller", en: "Cellar", aliases: ["kellerraum", "kr", "basement", "cellar"] },
  { de: "Heizungsraum", en: "Boiler room", aliases: ["heizung", "heizraum", "hzg", "boiler"] },
  {
    de: "Hausanschlussraum",
    en: "Plant room",
    aliases: ["har", "hausanschluss", "technik", "technikraum", "plant room"],
  },
  { de: "Garage", en: "Garage" },
  { de: "Dachboden", en: "Attic", aliases: ["boden", "spitzboden", "attic", "loft"] },
  { de: "Bibliothek", en: "Library", aliases: ["library"] },
  { de: "Boudoir", en: "Boudoir" },
  { de: "Salon", en: "Drawing room", aliases: ["drawing room", "parlour", "parlor"] },
];

/**
 * Words that are written on plans but are not room names: floor finishes, abbreviations of
 * measurements, opening labels. A word nearer one of these than any room name names nothing.
 */
const NOT_ROOMS = [
  "dielen",
  "parkett",
  "fliesen",
  "linoleum",
  "estrich",
  "terrazzo",
  "teppich",
  "laminat",
  "beton",
  "naturstein",
  "fenster",
  "tür",
  "tuer",
  "thür",
  "brh",
  "lh",
  "okff",
  "stg",
  "nf",
  "bf",
  "gf",
  "maßstab",
  "massstab",
  "grundriss",
  "erdgeschoss",
  "obergeschoss",
  "dachgeschoss",
  "kellergeschoss",
  "bestand",
  "nord",
  "strasse",
  "straße",
  "hof",
  "sill",
  "window",
  "door",
  "floor",
  "plan",
  "scale",
  "anmerkung",
  "stove",
  "ofen",
  "herd",
];

/** What the room model calls a room, for when nothing on the plan can be read. */
const KINDS: Record<string, string> = {
  kitchen: "Küche",
  living: "Wohnzimmer",
  bedroom: "Schlafzimmer",
  bath: "Bad",
  entry: "Flur",
  storage: "Abstellraum",
  garage: "Garage",
};

/** Lower case, umlauts and ß spelled out, everything but letters gone. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/**
 * The same without the spelled-out umlauts, as OCR often reads an umlaut as a plain vowel,
 * and "ü" read as "ii" (its two dots taken for two strokes).
 */
function plain(word: string): string {
  return word.replace(/ii/g, "u").replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");
}

/** Levenshtein distance: letters to change, add or drop to turn `a` into `b`. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1;
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + same));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** 1 for the same word, falling with every letter wrong; short words (abbreviations) only exactly. */
function similarity(word: string, term: string): number {
  if (word === term) return 1;
  if (term.length <= 4 || word.length <= 3) return 0;
  const best = Math.min(distance(word, term), distance(plain(word), plain(term)));
  return 1 - best / Math.max(word.length, term.length);
}

/** Below this a word is not taken for the name it resembles. */
const ENOUGH = 0.72;

interface Term {
  text: string;
  entry: RoomName | null;
}

const TERMS: Term[] = [
  ...ROOM_NAMES.flatMap((entry) =>
    [entry.de, entry.en, ...(entry.aliases ?? [])].map((t) => ({ text: normalize(t), entry })),
  ),
  ...NOT_ROOMS.map((t) => ({ text: normalize(t), entry: null })),
];

/** The dictionary entry a written word (or line) most likely means, with how sure, or null. */
export function matchRoomName(text: string): { entry: RoomName; score: number } | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  // Single words and neighbouring pairs ("living room", "wohn kueche" read with a gap).
  const pieces = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i++) pieces.add(`${words[i]} ${words[i + 1]}`);
  pieces.add(words.join(" "));
  let best: { term: Term; score: number } | null = null;
  for (const piece of pieces) {
    for (const term of TERMS) {
      const score = similarity(piece, term.text);
      if (score > (best?.score ?? 0)) best = { term, score };
    }
  }
  if (!best || best.score < ENOUGH || best.term.entry === null) return null;
  return { entry: best.term.entry, score: best.score };
}

/** A room's name in one language: a dictionary name, or two of them joined ("Wohnen/Schlafen"). */
export function roomNameFor(
  text: string,
  language: Language,
): { name: string; score: number } | null {
  const parts = text.split(/\s*(?:\/|\bund\b|\band\b|&|\+)\s*/i).filter((p) => p.trim().length > 0);
  const [first, second] = parts;
  if (parts.length === 2 && first && second) {
    const a = matchRoomName(first);
    const b = matchRoomName(second);
    if (a && b && a.entry !== b.entry) {
      return {
        name: `${a.entry[language]}/${b.entry[language]}`,
        score: Math.min(a.score, b.score),
      };
    }
  }
  const one = matchRoomName(text);
  return one ? { name: one.entry[language], score: one.score } : null;
}

export interface PlanLabel {
  text: string;
  /** 0 to 100, how sure the text reader was. */
  confidence: number;
  at: Vec2;
}

export interface PlanRoomKind {
  kind: string;
  at: Vec2;
}

export interface NameHint {
  at: Vec2;
  name: string;
  /** Higher wins when two hints fall into one room: read text over a guessed room type. */
  score: number;
}

/** Where the plan names its rooms, ready to name the rooms the editor makes from its walls. */
export function roomNameHints(
  labels: readonly PlanLabel[],
  kinds: readonly PlanRoomKind[],
  language: Language,
): NameHint[] {
  const hints: NameHint[] = [];
  for (const label of labels) {
    const named = roomNameFor(label.text, language);
    if (named)
      hints.push({
        at: label.at,
        name: named.name,
        score: 1 + named.score * (label.confidence / 100),
      });
  }
  for (const k of kinds) {
    const de = KINDS[k.kind];
    const entry = ROOM_NAMES.find((e) => e.de === de);
    if (entry) hints.push({ at: k.at, name: entry[language], score: 0.5 });
  }
  return hints.sort((a, b) => b.score - a.score);
}

/** The best hint inside a room's polygon, or null. */
export function nameForRoom(polygon: readonly Vec2[], hints: readonly NameHint[]): string | null {
  return hints.find((h) => pointInPolygon(h.at, polygon))?.name ?? null;
}

/** Every dictionary name as an English and German pair, for following the language. */
export const ROOM_NAME_PAIRS: [string, string][] = ROOM_NAMES.filter((e) => e.de !== e.en).map(
  (e) => [e.en, e.de],
);
