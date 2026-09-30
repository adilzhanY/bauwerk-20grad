/**
 * Talking to our own server about accounts (TODO Part 20). The browser never talks to the
 * database: it signs up and in here, keeps the token the server hands back, and sends it with
 * every request to the collaboration server.
 *
 * Without a server (VITE_API_URL unset: the GitHub Pages build, or local work without one)
 * there are no accounts and the app works as a local editor.
 */
import { syncConfigFromEnv } from "@/sync/client";
import type { MessageKey } from "@/i18n";
import { accountSchema } from "./schema";
import type { AccountData, SignIn, SignUp } from "./schema";

const TOKEN_KEY = "bauwerk.session";

export function apiBase(): string | null {
  return syncConfigFromEnv()?.apiUrl ?? null;
}

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Blocked storage: the session lasts for this page only.
  }
}

/** The current token, or null signed out. Async, as the sync client expects. */
export function accessToken(): Promise<string | null> {
  return Promise.resolve(storedToken());
}

/** The header that carries the token to the server, when there is one. */
export function authHeaders(): Promise<Record<string, string>> {
  const token = storedToken();
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  return Promise.resolve(headers);
}

/** A refused sign up or sign in: the message for the form, and one per field. */
export interface AuthFailure {
  error: MessageKey;
  fields: Partial<Record<keyof SignUp, MessageKey>>;
}

const REASONS: Record<string, MessageKey> = {
  credentials: "auth.error.credentials",
  usernameTaken: "auth.error.usernameTaken",
  tooMany: "auth.error.tooMany",
  invalid: "auth.error.invalid",
  off: "auth.error.off",
};

/** What the server's refusal means for the form. */
export async function failureOf(res: Response): Promise<AuthFailure> {
  let body: { error?: unknown; fields?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not JSON: a proxy or server error page.
  }
  const reason = typeof body.error === "string" ? body.error : "";
  const fields =
    body.fields && typeof body.fields === "object"
      ? (Object.fromEntries(
          Object.entries(body.fields as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string" && e[1].startsWith("auth."),
          ),
        ) as AuthFailure["fields"])
      : {};
  return { error: REASONS[reason] ?? "auth.error.other", fields };
}

const NETWORK: AuthFailure = { error: "auth.error.network", fields: {} };

export type SessionResult =
  { ok: true; token: string; account: AccountData } | ({ ok: false } & AuthFailure);

async function session(path: string, body: SignIn | SignUp): Promise<SessionResult> {
  const base = apiBase();
  if (!base) return { ok: false, error: "auth.error.off", fields: {} };
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, ...NETWORK };
  }
  if (!res.ok) return { ok: false, ...(await failureOf(res)) };
  const data = (await res.json()) as { token?: unknown; user?: unknown };
  const account = accountSchema.safeParse(data.user);
  if (typeof data.token !== "string" || !account.success)
    return { ok: false, error: "auth.error.other", fields: {} };
  return { ok: true, token: data.token, account: account.data };
}

export const signUpRequest = (values: SignUp) => session("/auth/sign-up", values);
export const signInRequest = (values: SignIn) => session("/auth/sign-in", values);

/** Whether the server has accounts: true, false, or null when it cannot be reached. */
export async function accountsMode(): Promise<boolean | null> {
  const base = apiBase();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/auth/mode`);
    if (!res.ok) return null;
    return ((await res.json()) as { accounts?: unknown }).accounts === true;
  } catch {
    return null;
  }
}

/** The account behind the stored token: the account, "invalid" (sign in again), or null offline. */
export async function currentAccount(): Promise<AccountData | "invalid" | null> {
  const base = apiBase();
  const token = storedToken();
  if (!base || !token) return "invalid";
  try {
    const res = await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) return "invalid";
    if (!res.ok) return null;
    const account = accountSchema.safeParse(await res.json());
    return account.success ? account.data : "invalid";
  } catch {
    return null;
  }
}

/** Whether a username is still free; null when the server cannot say. */
export async function usernameFree(name: string): Promise<boolean | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/auth/username-available?name=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return ((await res.json()) as { available: boolean }).available;
  } catch {
    return null;
  }
}
