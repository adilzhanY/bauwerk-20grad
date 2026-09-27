import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey } from "jose";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createApp } from "../app";
import { authConfigFromEnv } from "./auth.service";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const ISSUER = "https://test-project.supabase.co/auth/v1";

let pool: Pool;
let app: INestApplication;
let base: string;
let signingKey: CryptoKey;
let foreignKey: CryptoKey;
const ada = { id: randomUUID(), username: "Ada" };
const bob = { id: randomUUID(), username: "bob_2" };
const sockets: Socket[] = [];

/** A token as Supabase issues it, signed with the test key unless told otherwise. */
async function token(
  user: { id: string },
  options: { key?: CryptoKey; expiresIn?: string; audience?: string } = {},
) {
  return new SignJWT({ role: "authenticated", user_metadata: { username: "from-client" } })
    .setProtectedHeader({ alg: "ES256", kid: "test" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(options.key ?? signingKey);
}

const call = (method: string, path: string, bearer?: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  foreignKey = (await generateKeyPair("ES256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "test", alg: "ES256" };
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, {
    logger: false,
    auth: { mode: "supabase", issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) },
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
  await pool.query("TRUNCATE app.project_members, app.project_events, app.projects, app.profiles");
  await pool.query("INSERT INTO app.profiles (id, username) VALUES ($1, $2), ($3, $4)", [
    ada.id,
    ada.username,
    bob.id,
    bob.username,
  ]);
});

describe("accounts on", () => {
  it("turns away a request without a valid token, and leaves health and the name check open", async () => {
    expect((await call("GET", "/projects")).status).toBe(401);
    expect((await call("GET", "/projects", "not-a-token")).status).toBe(401);
    expect((await call("GET", "/projects", await token(ada, { expiresIn: "-1m" }))).status).toBe(
      401,
    );
    expect((await call("GET", "/projects", await token(ada, { key: foreignKey }))).status).toBe(
      401,
    );
    expect((await call("GET", "/projects", await token(ada, { audience: "anon" }))).status).toBe(
      401,
    );
    expect((await call("GET", "/health")).status).toBe(200);
    expect((await call("GET", "/auth/username-available?name=someone")).status).toBe(200);
  });

  it("makes the creator the owner, lets a signed in stranger join by the link, and only the owner delete", async () => {
    const adaToken = await token(ada);
    const bobToken = await token(bob);
    const created = await call("POST", "/projects", adaToken, { building: exampleHouse("en") });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // Bob has the link but is not a member yet.
    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(403);
    expect(await (await call("GET", "/projects", bobToken)).json()).toEqual([]);
    expect((await call("POST", `/projects/${id}/join`, bobToken)).status).toBe(200);
    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(200);
    const listed = (await (await call("GET", "/projects", bobToken)).json()) as {
      id: string;
      owner: string;
    }[];
    expect(listed).toEqual([expect.objectContaining({ id, owner: "Ada" })]);

    // The history names people by their account, never by what the client claimed.
    const versions = (await (await call("GET", `/projects/${id}/versions`, bobToken)).json()) as {
      actor: string;
    }[];
    expect(versions[0]?.actor).toBe("Ada");

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

    const created = await call("POST", "/projects", await token(ada), {
      building: exampleHouse("en"),
    });
    const { id } = (await created.json()) as { id: string };
    const bobToken = await token(bob);
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
    expect(actors[0]?.actor).toBe("bob_2");
    expect(actors[0]?.color).not.toBe("#000000");
    // Joining by socket made Bob a member.
    expect((await call("GET", `/projects/${id}`, bobToken)).status).toBe(200);
  });

  it("says whether a username is free, ignoring case, and whether it is allowed at all", async () => {
    const check = async (name: string) =>
      (await (
        await call("GET", `/auth/username-available?name=${encodeURIComponent(name)}`)
      ).json()) as { valid: boolean; available: boolean };
    expect(await check("ada")).toEqual({ valid: true, available: false });
    expect(await check("Grace")).toEqual({ valid: true, available: true });
    expect(await check("no spaces")).toEqual({ valid: false, available: false });
    expect(await check("ab")).toEqual({ valid: false, available: false });
  });
});

describe("authConfigFromEnv", () => {
  it("is off without Supabase in development, and refuses to run open in production", () => {
    expect(authConfigFromEnv({ NODE_ENV: "development" })).toEqual({ mode: "off" });
    expect(() => authConfigFromEnv({ NODE_ENV: "production" })).toThrow(/SUPABASE_URL/);
    const on = authConfigFromEnv({
      SUPABASE_URL: "https://x.supabase.co/",
      SUPABASE_JWT_SECRET: "s",
    });
    expect(on).toMatchObject({ mode: "supabase", issuer: "https://x.supabase.co/auth/v1" });
  });
});
