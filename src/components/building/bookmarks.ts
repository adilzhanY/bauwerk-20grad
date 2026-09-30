import { syncBookmark } from "@/auth/userData";

/** Buildings the user bookmarked, kept in the browser, and with the account when signed in. */
const KEY = "bauwerk.bookmarks";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isBookmarked(gid: string): boolean {
  return read().includes(gid);
}

/** Add or remove the bookmark; returns whether it is bookmarked afterwards. */
export function toggleBookmark(gid: string): boolean {
  const list = read();
  const next = list.includes(gid) ? list.filter((x) => x !== gid) : [...list, gid];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Blocked storage: the bookmark lasts for this page only.
  }
  syncBookmark(gid, next.includes(gid));
  return next.includes(gid);
}
