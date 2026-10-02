import { colorFor } from "@/sync/colors";

/** A piece of a note's text: plain, or an @mention of a member, in that person's colour. */
export interface MentionPart {
  text: string;
  color?: string;
}

/**
 * Splits `text` at its @mentions of people in the project. Only a complete username of a
 * member counts (any case), so "@ann" while typing "@anna_pc1" stays plain until it is whole,
 * and a name nobody has stays plain too.
 */
export function mentionParts(
  text: string,
  members: readonly { userId: string; username: string }[],
): MentionPart[] {
  const byName = new Map(members.map((m) => [m.username.toLowerCase(), m.userId]));
  const parts: MentionPart[] = [];
  let at = 0;
  for (const match of text.matchAll(/(^|\s)@([A-Za-z0-9_-]{1,24})(?![A-Za-z0-9_-])/g)) {
    const name = match[2] ?? "";
    const userId = byName.get(name.toLowerCase());
    if (userId === undefined) continue;
    const start = match.index + (match[1] ?? "").length;
    if (start > at) parts.push({ text: text.slice(at, start) });
    const end = start + 1 + name.length;
    parts.push({ text: text.slice(start, end), color: colorFor(userId) });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
