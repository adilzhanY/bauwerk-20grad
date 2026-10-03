import { useAuth } from "@/auth/store";
import type { MessageKey } from "@/i18n";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * Where the AI runs, when it is not a server that is always on: VITE_AI_HOST at build time,
 * for example "Adil's PC" for a demo whose SAM 3 runs on a home computer.
 */
const named = (import.meta.env.VITE_AI_HOST as string | undefined)?.trim() ?? "";
// An empty setting names nothing.
export const AI_HOST = named.length > 0 ? named : null;

/**
 * What to say while the AI cannot be reached. The AI is for signed in people only (the server
 * refuses its routes otherwise), so a visitor who is not signed in is asked to sign in: the
 * refusal is not the computer being off. Otherwise the computer it runs on is off, if named.
 */
export function aiOffText(t: Translate): string {
  if (useAuth.getState().status === "signedOut") return t("ai.signIn");
  return AI_HOST ? t("ai.offHost", { host: AI_HOST }) : t("ai.off");
}
