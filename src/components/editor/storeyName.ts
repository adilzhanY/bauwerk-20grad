/**
 * The short name of a storey on the pill: EG for the ground floor, the floor number above
 * it, KG for a storey named as a basement, DG for one named as an attic.
 */
export function storeyShortName(index: number, name: string): string {
  if (/keller|basement|\bkg\b/i.test(name)) return "KG";
  if (/dach|attic|\bdg\b/i.test(name)) return "DG";
  return index === 0 ? "EG" : String(index);
}
