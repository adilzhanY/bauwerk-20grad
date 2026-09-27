import { fromJson } from "@/geometry/export";
import type { Building } from "@/geometry/types";
import type { ImportResult } from "@/geometry/export";

/**
 * A building handed over in the page link, as `#import=<base64url of the Bauwerk JSON>`.
 * The lod2 viewer opens Bauwerk this way after a facade survey, so no file has to be saved
 * and picked. The fragment never reaches a server.
 */
const PREFIX = "#import=";

/** The JSON text in a link fragment, or null when the fragment carries none or is broken. */
export function jsonFromHash(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  const encoded = hash.slice(PREFIX.length);
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The building in a link fragment: null when there is none, else the import result. */
export function importFromHash(hash: string, language: "en" | "de"): ImportResult | null {
  if (!hash.startsWith(PREFIX)) return null;
  const text = jsonFromHash(hash);
  if (text === null) return { ok: false, error: { code: "invalidJson" } };
  return fromJson(text, language);
}

/** The fragment for a Bauwerk file, the counterpart of `jsonFromHash`. */
export function hashForJson(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type LinkNotice = { ok: true; name: string } | { ok: false };

/**
 * Run once at start, before the first render: load a building handed over in the link and
 * clear the fragment, so a reload does not load it again. Loading is one undo step. Returns
 * what the start screen should tell the user, or null when the link carried nothing.
 */
export function applyLinkImport(
  language: "en" | "de",
  load: (building: Building) => void,
): LinkNotice | null {
  const result = importFromHash(window.location.hash, language);
  if (!result) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!result.ok) return { ok: false };
  load(result.building);
  return { ok: true, name: result.building.name };
}
