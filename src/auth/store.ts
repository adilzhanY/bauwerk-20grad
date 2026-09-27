import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { colorFor } from "@/sync/colors";
import { supabase, accountsEnabled } from "./supabase";
import { authErrorKey } from "./errors";
import type { MessageKey } from "@/i18n";

export interface Account {
  id: string;
  email: string;
  username: string;
  color: string;
}

/**
 * Who is signed in. Its own small store: the session is not editor state and must not enter
 * the editor's undo history. "off" means the app was built without accounts.
 */
interface AuthState {
  status: "off" | "loading" | "signedOut" | "signedIn";
  account: Account | null;
}

export const useAuth = create<AuthState>(() => ({
  status: accountsEnabled ? "loading" : "off",
  account: null,
}));

function accountOf(session: Session | null): Account | null {
  if (!session) return null;
  const { id, email, user_metadata: meta } = session.user;
  const username =
    typeof (meta as { username?: unknown }).username === "string"
      ? (meta as { username: string }).username
      : fallbackName(email);
  return { id, email: email ?? "", username, color: colorFor(id) };
}

/** Without a username in the account: the part of the email before @, or "user". */
function fallbackName(email: string | undefined): string {
  const local = email?.split("@")[0];
  return local !== undefined && local !== "" ? local : "user";
}

/** Follows the session for the lifetime of the page. Call once at start. */
export function startAuth(): void {
  if (!supabase) return;
  const apply = (session: Session | null) => {
    const account = accountOf(session);
    useAuth.setState({ status: account ? "signedIn" : "signedOut", account });
  };
  void supabase.auth.getSession().then(({ data }) => {
    apply(data.session);
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    apply(session);
  });
}

/** Signs in; null on success, else the message to show. */
export async function signIn(email: string, password: string): Promise<MessageKey | null> {
  if (!supabase) return "auth.error.off";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? authErrorKey(error) : null;
}

/** Creates the account and signs in. The username rides along for the profile trigger. */
export async function signUp(
  email: string,
  password: string,
  username: string,
  usernameWasFree: boolean,
): Promise<MessageKey | null> {
  if (!supabase) return "auth.error.off";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  if (error) return authErrorKey(error, usernameWasFree);
  // With "Confirm email" on in Supabase there would be no session yet (TODO F.1: it is off).
  return data.session ? null : "auth.error.confirmationOn";
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
