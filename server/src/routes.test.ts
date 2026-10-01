import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createApp } from "./app";
import { resetLimits } from "./auth/auth.service";
import { DatabaseStore } from "./files/store";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const SECRET = "a-test-secret-that-is-long-enough-for-hs256-0123456789";

let pool: Pool;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, {
    logger: false,
    auth: { mode: "on", secret: new TextEncoder().encode(SECRET) },
    files: new DatabaseStore(pool),
  });
  await app.listen(0);
  base = `http://127.0.0.1:${String(((app.getHttpServer() as Server).address() as { port: number }).port)}`;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  resetIds();
  resetLimits();
  await pool.query("TRUNCATE app.projects, app.users, app.file_blobs CASCADE");
});

/** Ids that cannot exist: not a uuid, a uuid-shaped string of dashes, a path escape, a huge one. */
const JUNK = ["not-a-uuid", "-".repeat(36), "..%2F..%2Fetc", "x".repeat(300)];

describe("every route with ids that cannot exist", () => {
  it("answers 4xx, never 500, for a signed in person", async () => {
    const signedUp = await fetch(`${base}/auth/sign-up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Ada",
        lastName: "Lovelace",
        username: "ada_l",
        password: "Correct-Horse-7-Battery",
      }),
    });
    const { token } = (await signedUp.json()) as { token: string };
    const created = await fetch(`${base}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ building: exampleHouse("en") }),
    });
    const { id: real } = (await created.json()) as { id: string };

    const failures: string[] = [];
    for (const junk of JUNK) {
      const routes: [string, string, unknown?][] = [
        ["GET", `/projects/${junk}`],
        ["DELETE", `/projects/${junk}`],
        ["GET", `/projects/${junk}/link`],
        ["GET", `/projects/${junk}/photos`],
        ["GET", `/projects/${junk}/photos/1`],
        ["GET", `/projects/${junk}/versions`],
        ["GET", `/projects/${junk}/versions/1`],
        ["GET", `/projects/${junk}/members`],
        ["POST", `/projects/${junk}/members`, { userId: junk, role: "editor" }],
        ["PATCH", `/projects/${real}/members/${junk}`, { role: "viewer" }],
        ["DELETE", `/projects/${real}/members/${junk}`],
        ["GET", `/projects/${junk}/access-requests`],
        ["POST", `/projects/${junk}/access-requests`, {}],
        ["POST", `/projects/${real}/access-requests/${junk}`, { role: "viewer" }],
        ["GET", `/projects/${junk}/files`],
        ["GET", `/projects/${real}/files/${junk}`],
        ["DELETE", `/projects/${real}/files/${junk}`],
        ["GET", `/projects/${junk}/threads`],
        ["PATCH", `/projects/${real}/threads/${junk}`, { resolved: true }],
        ["POST", `/projects/${real}/threads/${junk}/comments`, { text: "x" }],
        ["PATCH", `/projects/${real}/threads/comments/${junk}`, { text: "x" }],
        ["DELETE", `/projects/${real}/threads/comments/${junk}`],
        ["GET", `/projects/${junk}/named`],
        ["PATCH", `/projects/${real}/named/${junk}`, { name: "x" }],
        ["DELETE", `/projects/${real}/named/${junk}`],
        ["POST", `/projects/${junk}/join`, {}],
        ["POST", `/projects/${junk}/ops`, { clientId: "a", seq: 1, ops: [] }],
        ["POST", `/reports/${junk}`],
      ];
      for (const [method, path, body] of routes) {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status >= 500 && res.status !== 503) {
          failures.push(`${method} ${path} -> ${String(res.status)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
