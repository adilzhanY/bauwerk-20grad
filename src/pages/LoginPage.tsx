import { useEffect, useId, useState } from "react";
import type { SyntheticEvent } from "react";
import { Check, Circle, LogIn, UserPlus } from "lucide-react";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { safeNext } from "@/app/router";
import { PageTitle } from "@/components/shared/PageTitle";
import { Presence } from "@/components/shared/Presence";
import { Notice } from "@/components/shared/Notice";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomFormInput } from "@/components/shared/CustomFormInput";
import { CustomTabPanel, CustomTabs } from "@/components/shared/CustomTabs";
import { cx } from "@/components/shared/cx";
import { signIn, signUp, useAuth } from "@/auth/store";
import { usernameFree } from "@/auth/api";
import {
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_RULES,
  USERNAME_MAX,
  fieldErrors,
  signInSchema,
  signUpSchema,
  username as usernameRule,
} from "@/auth/schema";
import type { SignIn, SignUp } from "@/auth/schema";

type Mode = "signIn" | "signUp";

/**
 * Sign in with username and password, or create an account with first and last name, a
 * username and a strong password typed twice. Every field is checked with the same zod rules
 * as the server (src/auth/schema.ts): when the user leaves it, and all of them again on
 * submit. After either, back to where the user came from (`?next=`, same site only).
 */
export function LoginPage() {
  const t = useT();
  const tabsId = useId();
  const status = useAuth((s) => s.status);
  const [mode, setMode] = useState<Mode>("signIn");
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));

  // Signed in, whether just now or already: go on.
  useEffect(() => {
    if (status === "signedIn") window.location.replace(next);
  }, [status, next]);

  if (status === "off") {
    return (
      <div className="h-full overflow-y-auto">
        <main className="mx-auto max-w-md px-6 py-16">
          <PageTitle title={t("auth.title")} subtitle={t("auth.off")} />
        </main>
      </div>
    );
  }

  // The shell clips its pages: this one scrolls itself, so Sign up's last fields and its button
  // stay reachable on a laptop screen.
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-10 lg:py-16">
        <PageTitle title={t("auth.title")} subtitle={t("auth.intro")} />
        <CustomTabs
          id={tabsId}
          label={t("auth.title")}
          value={mode}
          tabs={[
            { value: "signIn", label: t("auth.signIn") },
            { value: "signUp", label: t("auth.signUp") },
          ]}
          onChange={setMode}
        />
        <CustomTabPanel id={tabsId} value={mode}>
          {mode === "signIn" ? <SignInForm /> : <SignUpForm />}
        </CustomTabPanel>
      </main>
    </div>
  );
}

/** The message of a refused form, above its button. */
function FormError({ error }: { error: MessageKey | null }) {
  const t = useT();
  return <Presence value={error}>{(e) => <Notice tone="warning">{t(e)}</Notice>}</Presence>;
}

/** Which fields to show errors for: the ones left once, or all after a submit. */
function useTouched<K extends string>() {
  const [touched, setTouched] = useState<Partial<Record<K, true>>>({});
  const [submitted, setSubmitted] = useState(false);
  return {
    shown: (field: K) => submitted || touched[field] === true,
    touch: (field: K) => {
      setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
    },
    submit: () => {
      setSubmitted(true);
    },
    submitted,
  };
}

function SignInForm() {
  const t = useT();
  const [values, setValues] = useState<SignIn>({ username: "", password: "" });
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const touched = useTouched<keyof SignIn>();
  const parsed = signInSchema.safeParse(values);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);
  const errorOf = (field: keyof SignIn) => {
    const key = errors[field];
    return touched.shown(field) && key ? t(key as MessageKey) : undefined;
  };
  const set = (field: keyof SignIn) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setError(null);
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    touched.submit();
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(parsed.data);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      aria-label={t("auth.signIn")}
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <CustomFormInput
        label={t("auth.username")}
        autoComplete="username"
        value={values.username}
        onChange={set("username")}
        onBlur={() => {
          touched.touch("username");
        }}
        error={errorOf("username")}
        maxLength={64}
        autoFocus
      />
      <CustomFormInput
        label={t("auth.password")}
        type="password"
        autoComplete="current-password"
        value={values.password}
        onChange={set("password")}
        onBlur={() => {
          touched.touch("password");
        }}
        error={errorOf("password")}
        maxLength={PASSWORD_MAX}
      />
      <FormError error={error} />
      <CustomButton
        type="submit"
        variant="primary"
        loading={busy}
        icon={<LogIn size={15} aria-hidden />}
      >
        {t("auth.signIn")}
      </CustomButton>
    </form>
  );
}

const EMPTY_SIGN_UP: SignUp = {
  firstName: "",
  lastName: "",
  username: "",
  password: "",
  confirmPassword: "",
};

/** The password rules one below the other, ticked off while typing. */
function PasswordRules({
  id,
  password,
  strict,
}: {
  id: string;
  password: string;
  strict: boolean;
}) {
  const t = useT();
  return (
    <div id={id} className="flex flex-col gap-1">
      <span className="text-xs text-muted">{t("auth.passwordRules")}</span>
      <ul className="flex flex-col gap-0.5" aria-live="polite">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li
              key={rule.key}
              className={cx(
                "flex items-center gap-1.5 text-xs transition-colors",
                met ? "text-ok" : strict ? "text-mark" : "text-muted",
              )}
            >
              {met ? (
                <Check size={13} aria-hidden />
              ) : (
                <Circle size={9} aria-hidden className="mx-0.5" />
              )}
              <span>{t(rule.key)}</span>
              <span className="sr-only">{met ? t("auth.ruleMet") : t("auth.ruleOpen")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SignUpForm() {
  const t = useT();
  const rulesId = useId();
  const [values, setValues] = useState<SignUp>(EMPTY_SIGN_UP);
  const [error, setError] = useState<MessageKey | null>(null);
  const [serverFields, setServerFields] = useState<Partial<Record<keyof SignUp, MessageKey>>>({});
  const [free, setFree] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const touched = useTouched<keyof SignUp>();
  const parsed = signUpSchema.safeParse(values);
  const errors = parsed.success ? {} : fieldErrors(parsed.error);

  // The name check, a moment after typing stops, for a name of the allowed form.
  useEffect(() => {
    if (!usernameRule.safeParse(values.username).success) return;
    let live = true;
    const timer = setTimeout(() => {
      void usernameFree(values.username.trim()).then((answer) => {
        if (live) setFree(answer);
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [values.username]);

  const errorOf = (field: keyof SignUp): string | undefined => {
    const server = serverFields[field];
    if (server) return t(server);
    if (field === "username" && free === false) return t("auth.error.usernameTaken");
    if (!touched.shown(field)) return undefined;
    const key = errors[field];
    if (!key) return undefined;
    // A missing password rule is shown in the checklist; the line under the field says so once.
    if (field === "password" && PASSWORD_RULES.some((r) => r.key === key))
      return touched.submitted ? t("auth.rule.passwordWeak") : undefined;
    return t(key as MessageKey);
  };

  const set = (field: keyof SignUp) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setError(null);
    setServerFields((f) => (f[field] ? { ...f, [field]: undefined } : f));
    if (field === "username") setFree(null);
  };
  const blur = (field: keyof SignUp) => () => {
    touched.touch(field);
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    touched.submit();
    if (!parsed.success || free === false || busy) {
      if (!parsed.success) setError("auth.error.invalid");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signUp(parsed.data);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setServerFields(result.fields);
    }
  };

  const usernameHint =
    free === true && usernameRule.safeParse(values.username).success
      ? t("auth.usernameFree")
      : t("auth.usernameRule");

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      aria-label={t("auth.signUp")}
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CustomFormInput
          label={t("auth.firstName")}
          autoComplete="given-name"
          value={values.firstName}
          onChange={set("firstName")}
          onBlur={blur("firstName")}
          error={errorOf("firstName")}
          maxLength={NAME_MAX + 10}
          autoFocus
        />
        <CustomFormInput
          label={t("auth.lastName")}
          autoComplete="family-name"
          value={values.lastName}
          onChange={set("lastName")}
          onBlur={blur("lastName")}
          error={errorOf("lastName")}
          maxLength={NAME_MAX + 10}
        />
      </div>
      <CustomFormInput
        label={t("auth.username")}
        autoComplete="username"
        value={values.username}
        onChange={set("username")}
        onBlur={blur("username")}
        hint={usernameHint}
        error={errorOf("username")}
        maxLength={USERNAME_MAX + 10}
      />
      <div className="flex flex-col gap-2">
        <CustomFormInput
          label={t("auth.password")}
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={set("password")}
          onBlur={blur("password")}
          error={errorOf("password")}
          describedBy={rulesId}
          maxLength={PASSWORD_MAX}
        />
        <PasswordRules id={rulesId} password={values.password} strict={touched.submitted} />
      </div>
      <CustomFormInput
        label={t("auth.confirmPassword")}
        type="password"
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={set("confirmPassword")}
        onBlur={blur("confirmPassword")}
        error={errorOf("confirmPassword")}
        maxLength={PASSWORD_MAX}
      />
      <FormError error={error} />
      <CustomButton
        type="submit"
        variant="primary"
        loading={busy}
        icon={<UserPlus size={15} aria-hidden />}
      >
        {t("auth.signUp")}
      </CustomButton>
    </form>
  );
}
