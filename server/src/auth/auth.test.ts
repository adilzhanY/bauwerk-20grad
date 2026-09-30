import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { SignJWT } from "jose";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createApp } from "../app";
import { authConfigFromEnv, resetLimits } from "./auth.service";
import { hashPassword, verifyPassword } from "./password";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const SECRET = "a-test-secret-that-is-long-enough-for-hs256-0123456789";

let pool: Pool;
let app: INestApplication;
let base: string;
const sockets: Socket[] = [];

const ada = {
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada_l",
  password: "Analytical-Engine1",
  confirmPassword: "Analytical-Engine1",
};
const bob = {
  firstName: "Bob",
  lastName: "Builder",
  username: "bob_2",
  password: "Can-we-fix-it-2",
  confirmPassword: "Can-we-fix-it-2",
};

const call = (method: string, path: string, bearer?: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface SessionBody {
  token: string;
  user: { id: string; username: string; firstName: string; lastName: string };
}

async function signUp(account: typeof ada): Promise<SessionBody> {
  const res = await call("POST", "/auth/sign-up", undefined, account);
  expect(res.status).toBe(201);
  return (await res.json()) as SessionBody;
}

const count = async (table: string) =>
  (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table}`)).rows[0]?.n ?? -1;

beforeAll(async () => {
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, {
    logger: false,
    auth: { mode: "on", secret: new TextEncoder().encode(SECRET) },
  });
  await app.listen(0);
  const address = (app.getHttpServer() as Server).address() as { port: number };
  base = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  resetIds();
  resetLimits();
  await pool.query(
    `TRUNCATE app.project_photos, app.project_members, app.project_events, app.projects,
       app.user_buildings, app.user_bookmarks, app.user_settings, app.users`,
  );
});

describe("signing up", () => {
  it("creates the account, signs it in at once, and keeps only a hash of the password", async () => {
    const session = await signUp(ada);
    expect(session.user).toMatchObject({
      username: "ada_l",
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(session.token.split(".")).toHaveLength(3);
    const me = await call("GET", "/auth/me", session.token);
    expect(await me.json()).toEqual(session.user);
    const stored = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM app.users",
    );
    const hash = stored.rows[0]?.password_hash ?? "";
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain(ada.password);
  });

  it("names every field that breaks a rule, and stores nothing", async () => {
    const res = await call("POST", "/auth/sign-up", undefined, {
      firstName: "",
      lastName: "L0velace",
      username: "a b",
      password: "short",
      confirmPassword: "other",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid",
      fields: {
        firstName: "auth.rule.firstNameMissing",
        lastName: "auth.rule.nameChars",
        username: "auth.rule.usernameChars",
        password: "auth.rule.passwordLength",
        confirmPassword: "auth.rule.mismatch",
      },
    });
    expect(await count("users")).toBe(0);
  });

  it("refuses a username that exists in any case", async () => {
    await signUp(ada);
    const res = await call("POST", "/auth/sign-up", undefined, { ...bob, username: "ADA_L" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "usernameTaken" });
    expect(await count("users")).toBe(1);
  });

  it("says whether a username is free, ignoring case, and whether it is allowed at all", async () => {
    await signUp(ada);
    const check = async (name: string) =>
      (await (
        await call("GET", `/auth/username-available?name=${encodeURIComponent(name)}`)
      ).json()) as { valid: boolean; available: boolean };
    expect(await check("ADA_L")).toEqual({ valid: true, available: false });
    expect(await check("grace")).toEqual({ valid: true, available: true });
    expect(await check("no spaces")).toEqual({ valid: false, available: false });
    expect(await check("ab")).toEqual({ valid: false, available: false });
  });
});

describe("signing in", () => {
  it("takes the username in any case and the right password", async () => {
    const { user } = await signUp(ada);
    const res = await call("POST", "/auth/sign-in", undefined, {
      username: "ADA_L",
      password: ada.password,
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as SessionBody;
    expect(session.user).toEqual(user);
    expect((await call("GET", "/auth/me", session.token)).status).toBe(200);
  });

  it("answers a wrong password and an unknown name alike", async () => {
    await signUp(ada);
    const wrong = await call("POST", "/auth/sign-in", undefined, {
      username: "ada_l",
      password: "Analytical-Engine2",
    });
    const unknown = await call("POST", "/auth/sign-in", undefined, {
      username: "nobody",
      password: ada.password,
    });
    const malformed = await call("POST", "/auth/sign-in", undefined, { username: 42 });
    for (const res of [wrong, unknown, malformed]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "credentials", fields: {} });
    }
  });

  it("stops guessing after ten wrong passwords for a name, even with the right one", async () => {
    await signUp(ada);
    for (let i = 0; i < 10; i++) {
      const res = await call("POST", "/auth/sign-in", undefined, {
        username: "ada_l",
        password: `Wrong-guess-${String(i)}`,
      });
      expect(res.status).toBe(401);
    }
    const res = await call("POST", "/auth/sign-in", undefined, {
      username: "ada_l",
      password: ada.password,
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "tooMany" });
  });
});

describe("tokens", () => {
  it("turns away a request without a valid token, and leaves health and the auth routes open", async () => {
    const { token, user } = await signUp(ada);
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("bauwerk")
      .setAudience("bauwerk")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("another-secret-another-secret-another-secret"));
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("bauwerk")
      .setAudience("bauwerk")
      .setExpirationTime("-1m")
      .sign(new TextEncoder().encode(SECRET));
    const otherAudience = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer("bauwerk")
      .setAudience("somebody-else")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    expect((await call("GET", "/projects", token)).status).toBe(200);
    for (const bad of [undefined, "not-a-token", forged, expired, otherAudience])
      expect((await call("GET", "/projects", bad)).status).toBe(401);
    expect((await call("GET", "/health")).status).toBe(200);
    expect((await call("GET", "/auth/username-available?name=x")).status).toBe(200);
    expect(await (await call("GET", "/auth/mode")).json()).toEqual({ accounts: true });
  });

  it("stop working the moment the account is deleted", async () => {
    const { token, user } = await signUp(ada);
    await pool.query("DELETE FROM app.users WHERE id = $1", [user.id]);
    expect((await call("GET", "/auth/me", token)).status).toBe(401);
  });
});

describe("projects with accounts", () => {
  it("makes the creator the owner, lets a signed in stranger join by the link, and only the owner delete", async () => {
    const adaToken = (await signUp(ada)).token;
    const bobToken = (await signUp(bob)).token;
    const created = await call("POST", "/projects", adaToken, { building: exampleHouse("en") });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(403);
    expect(await (await call("GET", "/projects", bobToken)).json()).toEqual([]);
    expect((await call("POST", `/projects/${id}/join`, bobToken)).status).toBe(200);
    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(200);
    const listed = (await (await call("GET", "/projects", bobToken)).json()) as {
      id: string;
      owner: string;
      summary: { energyClass: string };
    }[];
    expect(listed).toEqual([expect.objectContaining({ id, owner: "Ada Lovelace" })]);
    // The card is stored with its version: the second list reads it without the building.
    const stored = await pool.query<{ summary_version: number; version: number }>(
      "SELECT summary_version, version FROM app.projects WHERE id = $1",
      [id],
    );
    expect(stored.rows[0]?.summary_version).toBe(stored.rows[0]?.version);
    expect(await (await call("GET", "/projects", bobToken)).json()).toEqual(listed);

    const versions = (await (await call("GET", `/projects/${id}/versions`, bobToken)).json()) as {
      actor: string;
    }[];
    expect(versions[0]?.actor).toBe("Ada Lovelace");

    expect((await call("DELETE", `/projects/${id}`, bobToken)).status).toBe(403);
    expect((await call("DELETE", `/projects/${id}`, adaToken)).status).toBe(204);
    expect((await call("POST", `/projects/${id}/join`, bobToken)).status).toBe(404);
  });

  it("turns away a socket without a token, and names a signed in one by the account", async () => {
    const refused = io(base, { transports: ["websocket"], forceNew: true, reconnection: false });
    sockets.push(refused);
    const reason = await new Promise<string>((resolve) => {
      refused.on("connect_error", (error) => {
        resolve(error.message);
      });
    });
    expect(reason).toBe("signIn");

    const created = await call("POST", "/projects", (await signUp(ada)).token, {
      building: exampleHouse("en"),
    });
    const { id } = (await created.json()) as { id: string };
    const bobToken = (await signUp(bob)).token;
    const socket = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: bobToken });
      },
    });
    sockets.push(socket);
    const presence = new Promise<{ actors: { actor: string; color: string }[] }>((resolve) => {
      socket.on("presence", resolve);
    });
    const joined = (await socket.emitWithAck("join", {
      projectId: id,
      clientId: "tab",
      actor: "Mallory pretending",
      color: "#000000",
    })) as { ok: boolean };
    expect(joined.ok).toBe(true);
    const { actors } = await presence;
    expect(actors[0]?.actor).toBe("Bob Builder");
    expect(actors[0]?.color).not.toBe("#000000");
    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(200);
  });
});

describe("a user's own data", () => {
  const survey = {
    walls: {
      "DEBE02YY40000BOo:3": {
        partGid: "DEBE02YY40000BOo",
        surfaceIndex: 3,
        openings: [{ x: 1, y: 0.8, width: 1.2, height: 1.4, kind: "window" }],
        method: "drawn",
        updatedAt: 1,
      },
    },
    facts: { ageClass: "bis1918", ageClassConfirmed: true, storeys: 4 },
  };

  it("keeps settings, bookmarks, notes and surveys, each for their owner only", async () => {
    const adaToken = (await signUp(ada)).token;
    const bobToken = (await signUp(bob)).token;
    expect(
      (await call("PUT", "/me/settings", adaToken, { language: "de", theme: "dark" })).status,
    ).toBe(204);
    expect((await call("PUT", "/me/settings", adaToken, { projectsView: "map" })).status).toBe(204);
    expect((await call("PUT", "/me/bookmarks/DEBE02YY40000BOo", adaToken)).status).toBe(204);
    expect((await call("PUT", "/me/bookmarks/DEBE02YY40000BOo", adaToken)).status).toBe(204);
    expect(
      (
        await call("PUT", "/me/buildings/DEBE02YY40000BOo", adaToken, {
          note: "Keller feucht",
          survey,
        })
      ).status,
    ).toBe(204);
    const mine = await (await call("GET", "/me", adaToken)).json();
    expect(mine).toEqual({
      settings: { language: "de", theme: "dark", projectsView: "map" },
      bookmarks: ["DEBE02YY40000BOo"],
      buildings: [{ gid: "DEBE02YY40000BOo", note: "Keller feucht", survey }],
    });
    // Bob sees none of it.
    expect(await (await call("GET", "/me", bobToken)).json()).toEqual({
      settings: {},
      bookmarks: [],
      buildings: [],
    });
    // Clearing both fields removes the entry; removing the bookmark removes it.
    await call("PUT", "/me/buildings/DEBE02YY40000BOo", adaToken, { note: null, survey: null });
    await call("DELETE", "/me/bookmarks/DEBE02YY40000BOo", adaToken);
    expect(await (await call("GET", "/me", adaToken)).json()).toMatchObject({
      bookmarks: [],
      buildings: [],
    });
    expect((await call("GET", "/me")).status).toBe(401);
  });

  it("refuses data of the wrong shape", async () => {
    const token = (await signUp(ada)).token;
    expect((await call("PUT", "/me/settings", token, { language: "fr" })).status).toBe(400);
    expect(
      (await call("PUT", "/me/buildings/DEBE02YY40000BOo", token, { survey: { walls: "x" } }))
        .status,
    ).toBe(400);
    expect(
      (await call("PUT", "/me/buildings/DEBE02YY40000BOo", token, { note: "x".repeat(20_001) }))
        .status,
    ).toBe(400);
  });
});

describe("SQL injection", () => {
  const attacks = [
    "' OR '1'='1",
    "'; DROP TABLE app.users; --",
    "admin'--",
    '" OR ""="',
    "1; SELECT pg_sleep(5)",
    "') OR 1=1 --",
  ];

  it("gets nowhere through sign up, sign in, the name check, or the user's data", async () => {
    const { token } = await signUp(ada);
    for (const attack of attacks) {
      const up = await call("POST", "/auth/sign-up", undefined, {
        ...bob,
        username: attack,
        firstName: attack,
      });
      expect(up.status).toBe(400);
      const inn = await call("POST", "/auth/sign-in", undefined, {
        username: attack,
        password: attack,
      });
      expect(inn.status).toBe(401);
      const check = await call(
        "GET",
        `/auth/username-available?name=${encodeURIComponent(attack)}`,
      );
      expect(await check.json()).toEqual({ valid: false, available: false });
      const bookmark = await call("PUT", `/me/bookmarks/${encodeURIComponent(attack)}`, token);
      expect(bookmark.status).toBe(400);
      resetLimits();
    }
    // Text is stored as text: a note full of SQL comes back exactly as it went in.
    const note = attacks.join("\n");
    await call("PUT", "/me/buildings/DEBE02YY40000BOo", token, { note });
    const mine = (await (await call("GET", "/me", token)).json()) as {
      buildings: { note: string }[];
    };
    expect(mine.buildings[0]?.note).toBe(note);
    expect(await count("users")).toBe(1);
  });

  it("never builds a query by pasting values into its text", () => {
    // Every query in the server passes its values as parameters ($1, $2, ...). A query whose
    // text is a template with ${...} in it, or is glued together with +, fails this test.
    const root = fileURLToPath(new URL("../", import.meta.url));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) files.push(path);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\.query(?:<[^>]*>)?\(\s*(`[^`]*`|"[^"]*"\s*\+)/g)) {
        const sql = match[1] ?? "";
        if (sql.includes("${") || sql.endsWith("+")) offenders.push(`${file}: ${sql.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("passwords", () => {
  it("hash with a fresh salt every time and verify only the right one", async () => {
    const a = await hashPassword("Analytical-Engine1");
    const b = await hashPassword("Analytical-Engine1");
    expect(a).not.toBe(b);
    expect(await verifyPassword("Analytical-Engine1", a)).toBe(true);
    expect(await verifyPassword("analytical-engine1", a)).toBe(false);
    expect(await verifyPassword("Analytical-Engine1", "garbage")).toBe(false);
  });
});

describe("authConfigFromEnv", () => {
  it("is off without a secret in development, refuses to run open in production, and wants a long secret", () => {
    expect(authConfigFromEnv({ NODE_ENV: "development" })).toEqual({ mode: "off" });
    expect(() => authConfigFromEnv({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
    expect(authConfigFromEnv({ NODE_ENV: "production", ACCOUNTS: "off" })).toEqual({ mode: "off" });
    expect(() => authConfigFromEnv({ AUTH_SECRET: "short" })).toThrow(/32/);
    expect(authConfigFromEnv({ AUTH_SECRET: SECRET })).toMatchObject({ mode: "on" });
  });
});
