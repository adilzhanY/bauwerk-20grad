import { useEffect, useId, useState } from "react";
import type { SyntheticEvent } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { safeNext } from "@/app/router";
import { CustomButton } from "@/components/CustomButton";
import { CustomFormInput } from "@/components/CustomFormInput";
import { CustomTabPanel, CustomTabs } from "@/components/CustomTabs";
import { signIn, signUp, useAuth } from "@/auth/store";
import { syncConfigFromEnv } from "@/sync/client";

type Mode = "signIn" | "signUp";

/** The same rule as the server and the database: 3 to 24 letters, digits, _ or -. */
const USERNAME = /^[A-Za-z0-9_-]{3,24}$/;
const MIN_PASSWORD = 8;

/** Asks the collaboration server whether a username is still free. Null when it cannot say. */
async function usernameFree(name: string): Promise<boolean | null> {
  const cfg = syncConfigFromEnv();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.apiUrl}/auth/username-available?name=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { available: boolean }).available;
  } catch {
    return null;
  }
}

/**
 * Sign in, or create an account with email, password and a username. After either, back to
 * where the user came from (`?next=`, same site only), usually a shared project link.
 */
export function LoginPage() {
  const t = useT();
  const tabsId = useId();
  const status = useAuth((s) => s.status);
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [free, setFree] = useState<boolean | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));

  // Signed in, whether just now or already: go on.
  useEffect(() => {
    if (status === "signedIn") window.location.replace(next);
  }, [status, next]);

  // The name check, a moment after typing stops.
  useEffect(() => {
    if (mode !== "signUp" || !USERNAME.test(username)) return;
    let live = true;
    const timer = setTimeout(() => {
      void usernameFree(username).then((answer) => {
        if (live) setFree(answer);
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mode, username]);

  if (status === "off") {
    return (
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold text-ink">{t("auth.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("auth.off")}</p>
      </main>
    );
  }

  const usernameError =
    mode === "signUp" && username !== ""
      ? !USERNAME.test(username)
        ? t("auth.usernameRule")
        : free === false
          ? t("auth.error.usernameTaken")
          : undefined
      : undefined;
  const passwordError =
    mode === "signUp" && password !== "" && password.length < MIN_PASSWORD
      ? t("auth.error.weakPassword")
      : undefined;
  const ready =
    email.includes("@") &&
    password.length >= (mode === "signUp" ? MIN_PASSWORD : 1) &&
    (mode === "signIn" || (USERNAME.test(username) && free !== false));

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const failure =
      mode === "signIn"
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, username, free === true);
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t("auth.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("auth.intro")}</p>
      </div>
      <CustomTabs
        id={tabsId}
        label={t("auth.title")}
        value={mode}
        tabs={[
          { value: "signIn", label: t("auth.signIn") },
          { value: "signUp", label: t("auth.signUp") },
        ]}
        onChange={(value) => {
          setMode(value);
          setError(null);
        }}
      />
      <CustomTabPanel id={tabsId} value={mode}>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <CustomFormInput
            label={t("auth.email")}
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            autoFocus
          />
          {mode === "signUp" && (
            <CustomFormInput
              label={t("auth.username")}
              autoComplete="username"
              value={username}
              onChange={(value) => {
                setUsername(value);
                setFree(null);
              }}
              hint={t("auth.usernameRule")}
              {...(usernameError ? { error: usernameError } : {})}
            />
          )}
          <CustomFormInput
            label={t("auth.password")}
            type="password"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            value={password}
            onChange={setPassword}
            {...(passwordError ? { error: passwordError } : {})}
          />
          {error && (
            <p role="alert" className="text-sm text-mark">
              {t(error)}
            </p>
          )}
          <CustomButton
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!ready}
            icon={
              mode === "signIn" ? (
                <LogIn size={15} aria-hidden />
              ) : (
                <UserPlus size={15} aria-hidden />
              )
            }
          >
            {mode === "signIn" ? t("auth.signIn") : t("auth.signUp")}
          </CustomButton>
        </form>
      </CustomTabPanel>
    </main>
  );
}
