/**
 * The Supabase client, for signing in only. The browser never reads or writes the database:
 * it sends the access token to the collaboration server, which checks it (TODO Part 5).
 * Without VITE_SUPABASE_URL (local development, the GitHub Pages build) accounts are off and
 * the app works as before.
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// The publishable (anon) key is meant to be public; it only lets the browser use Supabase Auth.
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && key ? createClient(url, key) : null;
export const accountsEnabled = supabase !== null;

/** The current access token, refreshed by the library when it runs out; null signed out. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** The header that carries the token to the collaboration server, when there is one. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
