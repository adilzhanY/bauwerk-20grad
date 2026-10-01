/**
 * Short unique ids. In production they are random. Under Vitest they are a
 * counter, so snapshots and deep-equal assertions are stable across runs.
 */
// Outside Vite (the server's seed script under tsx) there is no import.meta.env.
const deterministic = (import.meta.env as ImportMetaEnv | undefined)?.MODE === "test";
let counter = 0;

export function createId(prefix = "id"): string {
  counter += 1;
  if (deterministic) return `${prefix}_${counter}`;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${random}${counter.toString(36)}`;
}

/** Test helper. Restarts the counter so every test starts at the same ids. */
export function resetIds(): void {
  counter = 0;
}

/**
 * A random id that is unique across tabs and browsers (a tab, a browser project, an AI job).
 * crypto.randomUUID exists only on https and localhost, so a page on plain http (a rented
 * graphics card host) falls back to Math.random.
 */
export function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
