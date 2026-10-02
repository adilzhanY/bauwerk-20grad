/**
 * Which storey a floor plan page shows, from the words printed on it: "Grundriss
 * Erdgeschoss", "1. OG", "Dachgeschoss", "2nd floor". Plans of German buildings name the
 * storey in the title or the title block, and a PDF of the whole building has one per page.
 */

/** A storey level: 0 the ground floor, 1 the first upper floor, -1 a basement, "top" the attic. */
export type Level = number | "top";

const WORD = String.raw`(?:^|[^\p{L}\p{N}])`;
const END = String.raw`(?=$|[^\p{L}\p{N}])`;
const rx = (body: string, flags = "iu") => new RegExp(`${WORD}(?:${body})${END}`, flags);

// German words are inflected ("des Erdgeschosses"): any ending counts.
const inflected = (words: string) => rx(String.raw`(?:${words})\p{L}*`);
const BASEMENT = [
  inflected("kellergeschoss|keller|untergeschoss|souterrain|basement|cellar"),
  rx("KG|UG", "u"),
];
const GROUND = [inflected("erdgeschoss|hochparterre|parterre"), rx("ground floor"), rx("EG", "u")];
const ATTIC = [inflected("dachgeschoss|dachboden|attic|loft"), rx("DG", "u")];
// "1. Obergeschoss", "1. OG", "2.OG", "1 Stock", "1st floor", "3rd floor".
const NUMBERED = [
  new RegExp(
    String.raw`${WORD}(\d{1,2})\s*\.?\s*(?:obergeschoss\p{L}*|stock|etage|og)${END}`,
    "iu",
  ),
  new RegExp(String.raw`${WORD}og\s*(\d{1,2})${END}`, "iu"),
  new RegExp(String.raw`${WORD}(\d{1,2})\s*(?:st|nd|rd|th)\s+floor${END}`, "iu"),
];
const UPPER = [inflected("obergeschoss"), rx("upper floor"), rx("OG", "u")];

// The plan's title, "Grundriss Erdgeschoss", "Grundriss des 1. Obergeschosses", "Floor plan,
// ground floor": what follows it is the storey this page shows. Notes elsewhere on the sheet
// can name other storeys ("Wohnungen ab 1. OG", "Treppe zum DG").
const TITLE = /(?:grundriss\p{L}*|floor\s*plan)[\s,:.-]+((?:des|der|vom|im|of the)?[^\n]{0,40})/giu;

/** The storey a page's text names, or null when it names none; its plan title first. */
export function levelFromText(text: string): Level | null {
  for (const title of text.matchAll(TITLE)) {
    const level = levelIn(title[1] ?? "");
    if (level !== null) return level;
  }
  return levelIn(text);
}

function levelIn(text: string): Level | null {
  for (const pattern of NUMBERED) {
    const match = pattern.exec(text);
    if (match?.[1]) return Number(match[1]);
  }
  if (GROUND.some((p) => p.test(text))) return 0;
  if (ATTIC.some((p) => p.test(text))) return "top";
  if (BASEMENT.some((p) => p.test(text))) return -1;
  // "Obergeschoss" without a number: the first one.
  if (UPPER.some((p) => p.test(text))) return 1;
  return null;
}

/**
 * The storey for each page: by the level its text names, then the pages that name none take the
 * storeys still free, from the lowest up, in page order. The model's storeys run from the ground
 * floor up; a basement plan has no storey to go to. A storey gets one page; null leaves a page out.
 */
export function storeysForPages(
  texts: readonly string[],
  storeyIds: readonly string[],
): (string | null)[] {
  const taken = new Set<string>();
  const result: (string | null)[] = texts.map((text) => {
    const level = levelFromText(text);
    if (level === null || level === -1) return null;
    const id = level === "top" ? storeyIds[storeyIds.length - 1] : storeyIds[level];
    if (!id || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
  const free = storeyIds.filter((id) => !taken.has(id));
  // Only pages that name no storey take a free one; a basement or a second ground floor stays out.
  return result.map((id, page) =>
    id === null && levelFromText(texts[page] ?? "") === null ? (free.shift() ?? null) : id,
  );
}
