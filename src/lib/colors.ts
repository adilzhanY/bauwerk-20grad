/**
 * Colours the 3D scene needs as JavaScript values. Chrome colours come from the
 * CSS tokens in index.css and are read at runtime so the scene follows the theme;
 * the model's own materials (plaster, timber, glass) do not change with the theme.
 */
export const colors = {
  // The 20° look: a mid grey model with dark storey bands and a red roof on a blue-grey ground.
  wall: "#e2e4e6",
  wallHover: "#eceef0",
  /** A party wall against a heated neighbour: darker, so it reads as not part of the facade. */
  wallShared: "#a9adb1",
  floor: "#bcc1c5",
  /** The thin line at every floor on the facade. */
  storeyLine: "#7d8286",
  window: "#c7d3dd",
  door: "#a67c52",
  interiorWall: "#d6d6d3",
  /** Selection blue. Read live from the theme where possible; this is the light default. */
  accent: "#1aa0ec",
  /** Mark red for warnings and invalid elements. */
  warning: "#e23b3b",
  fg: "#141414",
  muted: "#6b6b6b",
  bg: "#ffffff",
} as const;

/** Reads a CSS token from the root element. Falls back to the light default. */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v === "" ? fallback : v;
}

/** The fixed set of six zone colours the user can pick from. */
export const ZONE_COLORS = [
  "#e76f51",
  "#f4a261",
  "#e9c46a",
  "#2a9d8f",
  "#6c8ef5",
  "#b084cc",
] as const;
