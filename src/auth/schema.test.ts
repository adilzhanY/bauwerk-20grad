import { describe, expect, it } from "vitest";
import {
  PASSWORD_RULES,
  fieldErrors,
  firstName,
  password,
  signInSchema,
  signUpSchema,
  username,
} from "./schema";

const good = {
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada_l",
  password: "Analytical-Engine1",
  confirmPassword: "Analytical-Engine1",
};

const errorsOf = (value: unknown) => {
  const r = signUpSchema.safeParse(value);
  return r.success ? {} : fieldErrors(r.error);
};

describe("sign up rules", () => {
  it("accepts a good account and trims the names", () => {
    const r = signUpSchema.safeParse({ ...good, firstName: "  Ada ", username: " ada_l " });
    expect(r.success).toBe(true);
    expect(r.data?.firstName).toBe("Ada");
    expect(r.data?.username).toBe("ada_l");
  });

  it("takes names in any script, with spaces, apostrophes and hyphens", () => {
    for (const name of ["Zoë", "Ömer", "Jean-Luc", "O'Brien", "Мария", "Ádám Ernő", "李", "Łukasz"])
      expect(firstName.safeParse(name).success, name).toBe(true);
    for (const name of ["", "  ", "Ada1", "<script>", "-Ada", "Ada;DROP", "a".repeat(51)])
      expect(firstName.safeParse(name).success, name).toBe(false);
  });

  it("allows usernames of 3 to 24 letters, digits, underscores and hyphens only", () => {
    expect(username.safeParse("abc").success).toBe(true);
    expect(username.safeParse("a".repeat(24)).success).toBe(true);
    for (const name of ["ab", "a".repeat(25), "ada l", "ada@x", "ädä", "ada'--", "x;DROP TABLE"])
      expect(username.safeParse(name).success, name).toBe(false);
  });

  it("wants a strong password: length, lower, upper, digit and symbol", () => {
    expect(password.safeParse("Analytical-Engine1").success).toBe(true);
    const failing = (p: string) => password.safeParse(p).error?.issues.map((i) => i.message) ?? [];
    expect(failing("Short-1a")).toEqual(["auth.rule.passwordLength"]);
    expect(failing("ANALYTICAL-ENGINE1")).toEqual(["auth.rule.passwordLower"]);
    expect(failing("analytical-engine1")).toEqual(["auth.rule.passwordUpper"]);
    expect(failing("Analytical-Engine")).toEqual(["auth.rule.passwordDigit"]);
    expect(failing("AnalyticalEngine1")).toEqual(["auth.rule.passwordSymbol"]);
    expect(failing("x".repeat(129))).toContain("auth.rule.passwordLong");
    expect(PASSWORD_RULES.map((r) => r.test("Analytical-Engine1"))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("needs the confirmation to match, and a password without the username in it", () => {
    expect(errorsOf({ ...good, confirmPassword: "Analytical-Engine2" })).toEqual({
      confirmPassword: "auth.rule.mismatch",
    });
    const withName = "Ada_L-password-99";
    expect(errorsOf({ ...good, password: withName, confirmPassword: withName })).toEqual({
      password: "auth.rule.passwordHasUsername",
    });
  });

  it("names the first problem of every field", () => {
    expect(
      errorsOf({ firstName: "", lastName: "", username: "a", password: "x", confirmPassword: "" }),
    ).toEqual({
      firstName: "auth.rule.firstNameMissing",
      lastName: "auth.rule.lastNameMissing",
      username: "auth.rule.usernameShort",
      password: "auth.rule.passwordLength",
      confirmPassword: "auth.rule.mismatch",
    });
  });

  it("refuses anything that is not a string, and drops fields it does not know", () => {
    expect(signUpSchema.safeParse({ ...good, username: ["ada"] }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...good, firstName: { $ne: "" } }).success).toBe(false);
    const r = signUpSchema.safeParse({ ...good, isAdmin: true, id: "x" });
    expect(r.success && Object.keys(r.data)).toEqual([
      "firstName",
      "lastName",
      "username",
      "password",
      "confirmPassword",
    ]);
  });
});

describe("sign in rules", () => {
  it("only needs something in both fields", () => {
    expect(signInSchema.safeParse({ username: "ada_l", password: "x" }).success).toBe(true);
    const r = signInSchema.safeParse({ username: " ", password: "" });
    expect(r.success ? {} : fieldErrors(r.error)).toEqual({
      username: "auth.rule.usernameMissing",
      password: "auth.rule.passwordMissing",
    });
  });
});
