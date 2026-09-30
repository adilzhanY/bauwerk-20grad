import { create } from "zustand";
import { colorFor } from "@/sync/colors";
import {
  accountsMode,
  currentAccount,
  signInRequest,
  signUpRequest,
  storeToken,
  storedToken,
} from "./api";
import type { AuthFailure } from "./api";
import type { AccountData, SignIn, SignUp } from "./schema";

export interface Account extends AccountData {
  /** The colour others see this person in, the same on every device. */
  color: string;
}

/**
 * Who is signed in. Its own small store: the session is not editor state and must not enter
 * the editor's undo history. "off" means there are no accounts: no server, a server without
 * them, or a server that cannot be reached; the app then works as a local editor.
 */
interface AuthState {
  status: "off" | "loading" | "signedOut" | "signedIn";
  account: Account | null;
}

export const useAuth = create<AuthState>(() => ({ status: "loading", account: null }));

const toAccount = (data: AccountData): Account => ({ ...data, color: colorFor(data.id) });

/** The full name, as others see it in presence and history. */
export const fullName = (account: AccountData) => `${account.firstName} ${account.lastName}`;

/** Asks the server whether there are accounts and whose the kept token is. Call once at start. */
export async function startAuth(): Promise<void> {
  const mode = await accountsMode();
  if (mode !== true) {
    useAuth.setState({ status: "off", account: null });
    return;
  }
  if (!storedToken()) {
    useAuth.setState({ status: "signedOut", account: null });
    return;
  }
  const current = await currentAccount();
  if (current === "invalid") {
    storeToken(null);
    useAuth.setState({ status: "signedOut", account: null });
  } else if (current === null) {
    // The server answered a moment ago but not now: keep the token, try again later.
    useAuth.setState({ status: "signedOut", account: null });
  } else {
    useAuth.setState({ status: "signedIn", account: toAccount(current) });
  }
}

type Result = { ok: true } | ({ ok: false } & AuthFailure);

async function settle(
  request: Promise<Awaited<ReturnType<typeof signInRequest>>>,
): Promise<Result> {
  const result = await request;
  if (!result.ok) return result;
  storeToken(result.token);
  useAuth.setState({ status: "signedIn", account: toAccount(result.account) });
  return { ok: true };
}

export const signIn = (values: SignIn) => settle(signInRequest(values));
export const signUp = (values: SignUp) => settle(signUpRequest(values));

export function signOut(): void {
  storeToken(null);
  useAuth.setState({ status: "signedOut", account: null });
}
