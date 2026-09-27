/** The presence colours, one per person. Shared by the app and the collaboration server. */
export const PRESENCE_COLORS = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#6c8ef5", "#b084cc"];

/** One colour per account, the same on every device and in every tab: from the user id. */
export function colorFor(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? "#6c8ef5";
}
