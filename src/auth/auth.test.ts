import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "@/app/router";
import { initialsOf } from "@/components/shared/initials";
import { colorFor, PRESENCE_COLORS } from "@/sync/colors";
import { failureOf, storedToken, storeToken } from "./api";
import { signIn, signOut, startAuth, useAuth } from "./store";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ada = {
  id: "6f1c2b1e-0000-4000-8000-000000000001",
  username: "ada_l",
  firstName: "Ada",
  lastName: "Lovelace",
};

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "/collab");
  localStorage.clear();
  useAuth.setState({ status: "loading", account: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
  it("takes the first letter of the first and the last name, in any script", () => {
    expect(initialsOf("Ada", "Lovelace")).toBe("AL");
    expect(initialsOf("ömer", "çelik")).toBe("ÖÇ");
    expect(initialsOf(" Jean-Luc ", "Picard")).toBe("JP");
    expect(initialsOf("Мария", "Иванова")).toBe("МИ");
    expect(initialsOf("𝒜da", "Byron")).toBe("𝒜B");
  });

  it("gives one account the same colour everywhere, from the shared set", () => {
    expect(colorFor(ada.id)).toBe(colorFor(ada.id));
    expect(PRESENCE_COLORS).toContain(colorFor(ada.id));
  });
});

describe("the server's refusals", () => {
  it("become plain messages, with the fields it named", async () => {
    expect(await failureOf(json({ error: "credentials", fields: {} }, 401))).toEqual({
      error: "auth.error.credentials",
      fields: {},
    });
    expect(
      await failureOf(
        json({ error: "usernameTaken", fields: { username: "auth.error.usernameTaken" } }, 409),
      ),
    ).toEqual({
      error: "auth.error.usernameTaken",
      fields: { username: "auth.error.usernameTaken" },
    });
    expect((await failureOf(json({ error: "tooMany" }, 429))).error).toBe("auth.error.tooMany");
    // Anything else, or no JSON at all, is a plain "did not work"; odd field values are dropped.
    expect(await failureOf(new Response("<html>502</html>", { status: 502 }))).toEqual({
      error: "auth.error.other",
      fields: {},
    });
    expect(
      (await failureOf(json({ error: "invalid", fields: { username: 5, x: "<b>" } }, 400))).fields,
    ).toEqual({});
  });
});

describe("the session", () => {
  it("is off when the server has no accounts or cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ accounts: false }))),
    );
    await startAuth();
    expect(useAuth.getState().status).toBe("off");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await startAuth();
    expect(useAuth.getState().status).toBe("off");
  });

  it("signs in, keeps the token, restores the account on the next start, and signs out", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/mode")) return Promise.resolve(json({ accounts: true }));
      if (url.endsWith("/auth/sign-in")) {
        expect(JSON.parse(init?.body as string)).toEqual({
          username: "ada_l",
          password: "Analytical-Engine1",
        });
        return Promise.resolve(json({ token: "t.o.k", user: ada }));
      }
      if (url.endsWith("/auth/me")) {
        const auth = new Headers(init?.headers).get("authorization");
        return Promise.resolve(
          auth === "Bearer t.o.k" ? json(ada) : json({ error: "signIn" }, 401),
        );
      }
      return Promise.resolve(json({}, 404));
    });
    vi.stubGlobal("fetch", fetchMock);
    await startAuth();
    expect(useAuth.getState().status).toBe("signedOut");
    expect(await signIn({ username: "ada_l", password: "Analytical-Engine1" })).toEqual({
      ok: true,
    });
    expect(storedToken()).toBe("t.o.k");
    expect(useAuth.getState().account).toMatchObject({ firstName: "Ada", color: colorFor(ada.id) });
    useAuth.setState({ status: "loading", account: null });
    await startAuth();
    expect(useAuth.getState().status).toBe("signedIn");
    signOut();
    expect(storedToken()).toBeNull();
    expect(useAuth.getState().status).toBe("signedOut");
  });

  it("forgets a token the server no longer takes", async () => {
    storeToken("stale");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/auth/mode") ? json({ accounts: true }) : json({ error: "signIn" }, 401),
        ),
      ),
    );
    await startAuth();
    expect(useAuth.getState().status).toBe("signedOut");
    expect(storedToken()).toBeNull();
  });
});
