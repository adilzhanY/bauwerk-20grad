/** Up to two letters from a username: "ada_lovelace" is AL, "bob" is BO. */
export function initialsOf(username: string): string {
  const parts = username.split(/[_\-.\s]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : username.slice(0, 2);
  return letters.toUpperCase();
}
