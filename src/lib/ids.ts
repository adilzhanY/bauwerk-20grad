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
