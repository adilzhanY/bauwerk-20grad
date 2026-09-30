/**
 * The rules for an account, one file for the forms in the browser and the server that stores
 * the account. Every message is an i18n key (`auth.rule.*`), so the forms show it in the
 * user's language and the server sends the same key back.
 *
 * The database checks the same limits again (server/migrations/006_users.sql), so nothing
 * that bypasses the server's parsing could store an account these rules refuse.
 */
import { z } from "zod";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const NAME_MAX = 50;
export const PASSWORD_MIN = 10;
/** Bounds the work of hashing: scrypt over a megabyte of "password" is a denial of service. */
export const PASSWORD_MAX = 128;

export const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Letters of any script, and spaces, apostrophes, hyphens and dots between them. */
export const NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;

export const username = z
  .string()
  .trim()
  .min(USERNAME_MIN, { error: "auth.rule.usernameShort" })
  .max(USERNAME_MAX, { error: "auth.rule.usernameLong" })
  .regex(USERNAME_PATTERN, { error: "auth.rule.usernameChars" });

const personName = (short: string) =>
  z
    .string()
    .trim()
    .min(1, { error: short })
    .max(NAME_MAX, { error: "auth.rule.nameLong" })
    .regex(NAME_PATTERN, { error: "auth.rule.nameChars" });

export const firstName = personName("auth.rule.firstNameMissing");
export const lastName = personName("auth.rule.lastNameMissing");

/** The rules a password has to meet, each on its own for the checklist under the field. */
export const PASSWORD_RULES = [
  { key: "auth.rule.passwordLength", test: (p: string) => p.length >= PASSWORD_MIN },
  { key: "auth.rule.passwordLower", test: (p: string) => /\p{Ll}/u.test(p) },
  { key: "auth.rule.passwordUpper", test: (p: string) => /\p{Lu}/u.test(p) },
  { key: "auth.rule.passwordDigit", test: (p: string) => /\d/.test(p) },
  { key: "auth.rule.passwordSymbol", test: (p: string) => /[^\p{L}\p{N}\s]/u.test(p) },
] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number]["key"];

export const password = z
  .string()
  .max(PASSWORD_MAX, { error: "auth.rule.passwordLong" })
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES)
      if (!rule.test(value)) ctx.addIssue({ code: "custom", message: rule.key });
  });

export const signUpSchema = z
  .object({
    firstName,
    lastName,
    username,
    password,
    confirmPassword: z.string().max(PASSWORD_MAX, { error: "auth.rule.passwordLong" }),
  })
  .superRefine((value, ctx) => {
    if (value.confirmPassword !== value.password)
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "auth.rule.mismatch" });
    const name = value.username.trim().toLowerCase();
    if (name.length >= USERNAME_MIN && value.password.toLowerCase().includes(name))
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "auth.rule.passwordHasUsername",
      });
  });

export type SignUp = z.infer<typeof signUpSchema>;

/**
 * Signing in checks only the form of what was typed. A username of the wrong form cannot
 * exist, but it gets the same answer as a wrong password, so nothing tells which part was
 * wrong.
 */
export const signInSchema = z.object({
  username: z.string().trim().min(1, { error: "auth.rule.usernameMissing" }).max(64),
  password: z
    .string()
    .min(1, { error: "auth.rule.passwordMissing" })
    .max(PASSWORD_MAX, { error: "auth.rule.passwordLong" }),
});

export type SignIn = z.infer<typeof signInSchema>;

/** The account as the server returns it and the app shows it. */
export const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});

export type AccountData = z.infer<typeof accountSchema>;

/** The first error of each field, as the forms show them: one message under each field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    out[field] ??= issue.message;
  }
  return out;
}
