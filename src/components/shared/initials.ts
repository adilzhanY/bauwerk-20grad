/**
 * The two letters in the avatar: the first letter of the first name and of the last name,
 * "Ada Lovelace" is AL. Letters, not UTF-16 halves, so "Ömer Çelik" is ÖÇ and a name in any
 * script works.
 */
export function initialsOf(firstName: string, lastName: string): string {
  const first = (name: string) => Array.from(name.trim())[0] ?? "";
  return (first(firstName) + first(lastName)).toLocaleUpperCase();
}
