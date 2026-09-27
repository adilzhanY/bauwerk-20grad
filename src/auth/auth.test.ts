import { describe, expect, it } from "vitest";
import { safeNext } from "@/app/router";
import { initialsOf } from "@/app/initials";
import { colorFor, PRESENCE_COLORS } from "@/sync/colors";
import { authErrorKey } from "./errors";

describe("authErrorKey", () => {
  it("turns Supabase's answers into plain messages", () => {
    expect(authErrorKey({ code: "invalid_credentials" })).toBe("auth.error.credentials");
    expect(authErrorKey({ code: "user_already_exists" })).toBe("auth.error.emailTaken");
    expect(authErrorKey({ code: "weak_password" })).toBe("auth.error.weakPassword");
    expect(authErrorKey({ name: "AuthRetryableFetchError", status: 0 })).toBe("auth.error.network");
    expect(authErrorKey({ code: "something_new" })).toBe("auth.error.other");
  });

  it("reads the profile trigger's failure as a taken name only when the name was free just before", () => {
    const failure = { message: "Database error saving new user", status: 500 };
    expect(authErrorKey(failure, true)).toBe("auth.error.usernameTaken");
    expect(authErrorKey(failure, false)).toBe("auth.error.other");
  });
});

describe("safeNext", () => {
  it("goes back to a path on this site, and nowhere else", () => {
    expect(safeNext("/editor?project=abc")).toBe("/editor?project=abc");
    for (const bad of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "editor",
    ]) {
      expect(safeNext(bad)).toBe("/editor");
    }
  });
});

describe("initials and colours", () => {
  it("takes two letters from a username", () => {
    expect(initialsOf("ada_lovelace")).toBe("AL");
    expect(initialsOf("bob")).toBe("BO");
    expect(initialsOf("x")).toBe("X");
  });

  it("gives one account the same colour everywhere, from the shared set", () => {
    const id = "6f1c2b1e-0000-4000-8000-000000000001";
    expect(colorFor(id)).toBe(colorFor(id));
    expect(PRESENCE_COLORS).toContain(colorFor(id));
  });
});
