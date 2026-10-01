import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createApp } from "../app";
import { resetLimits } from "../auth/auth.service";
import { DatabaseStore } from "../files/store";
import { ThreadsService, mentionedNames } from "./threads.service";

/** Threads about the building (TODO Part 21, CE). */
const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const SECRET = "a-test-secret-that-is-long-enough-for-hs256-0123456789";

let pool: Pool;
let app: INestApplication;
let base: string;

const person = (firstName: string, username: string) => ({
  firstName,
  lastName: "Test",
  username,
  password: "Analytical-Engine1",
  confirmPassword: "Analytical-Engine1",
});

const call = (method: string, path: string, bearer: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function signUp(account: ReturnType<typeof person>) {
  const res = await fetch(`${base}/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  return (await res.json()) as { token: string; user: { id: string } };
}

interface ThreadBody {
  id: string;
  resolvedAt: string | null;
  comments: { id: string; text: string; authorName: string; editedAt: string | null }[];
}
const threads = async (id: string, token: string) =>
  (await (await call("GET", `/projects/${id}/threads`, token)).json()) as ThreadBody[];
const inbox = async (token: string) =>
  (
    (await (await call("GET", "/notifications", token)).json()) as {
      items: { kind: string; count: number }[];
    }
  ).items;

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

describe("mentions", () => {
  it("are @usernames, once each, not inside an email address", () => {
    expect(mentionedNames("@Lena_berg look, and @lena_berg again, @tom")).toEqual([
      "lena_berg",
      "tom",
    ]);
    expect(mentionedNames("write to ada@example.com")).toEqual([]);
  });
});

describe("threads", () => {
  it("commenters start and answer threads, viewers only read, and the people concerned are told", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const lena = await signUp(person("Lena", "lena_b"));
    const tom = await signUp(person("Tom", "tom_w"));
    const stranger = await signUp(person("Sam", "sam_s"));
    const { id } = (await (
      await call("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "commenter",
    });
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: tom.user.id,
      role: "viewer",
    });

    const started = await call("POST", `/projects/${id}/threads`, ada.token, {
      target: { kind: "wall", wallIndex: 2 },
      text: "Damp on the courtyard side. @lena_b can you check? @sam_s too",
    });
    expect(started.status).toBe(201);
    const { id: threadId } = (await started.json()) as { id: string };
    // Lena, a member, is told; Sam has no access and is told nothing.
    expect((await inbox(lena.token)).map((n) => n.kind)).toContain("mentioned");
    expect(await inbox(stranger.token)).toEqual([]);

    expect(
      (
        await call("POST", `/projects/${id}/threads/${threadId}/comments`, tom.token, {
          text: "me too",
        })
      ).status,
    ).toBe(403);
    expect((await call("GET", `/projects/${id}/threads`, stranger.token)).status).toBe(403);
    expect(
      (
        await call("POST", `/projects/${id}/threads/${threadId}/comments`, lena.token, {
          text: "Checked, it is dry now.",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call("POST", `/projects/${id}/threads/${threadId}/comments`, lena.token, {
          text: "Photo follows.",
        })
      ).status,
    ).toBe(204);
    // Two replies fold into one item for Ada.
    expect((await inbox(ada.token)).filter((n) => n.kind === "replied")).toEqual([
      expect.objectContaining({ count: 2 }),
    ]);

    const [thread] = await threads(id, tom.token);
    expect(thread?.comments.map((c) => c.authorName)).toEqual([
      "Ada Test",
      "Lena Test",
      "Lena Test",
    ]);

    expect(
      (await call("PATCH", `/projects/${id}/threads/${threadId}`, lena.token, { resolved: true }))
        .status,
    ).toBe(204);
    expect((await threads(id, ada.token))[0]?.resolvedAt).not.toBeNull();
    await call("PATCH", `/projects/${id}/threads/${threadId}`, lena.token, { resolved: false });
    expect((await threads(id, ada.token))[0]?.resolvedAt).toBeNull();
  });

  it("tells nobody who left the project about a reply in a thread they wrote in", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const lena = await signUp(person("Lena", "lena_b"));
    const { id } = (await (
      await call("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "commenter",
    });
    const started = await call("POST", `/projects/${id}/threads`, lena.token, {
      target: { kind: "building" },
      text: "First look at the roof",
    });
    const { id: threadId } = (await started.json()) as { id: string };
    expect(
      (await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token)).status,
    ).toBe(204);
    await call("POST", `/projects/${id}/threads/${threadId}/comments`, ada.token, {
      text: "secret plan after removal",
    });
    expect((await inbox(lena.token)).map((n) => n.kind)).not.toContain("replied");
  });

  it("a comment is edited only by its author, deleted by its author or the owner, and an empty thread goes", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const lena = await signUp(person("Lena", "lena_b"));
    const { id } = (await (
      await call("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });
    await call("POST", `/projects/${id}/threads`, lena.token, {
      target: { kind: "building" },
      text: "First",
    });
    const [thread] = await threads(id, ada.token);
    const commentId = thread?.comments[0]?.id ?? "";
    expect(
      (
        await call("PATCH", `/projects/${id}/threads/comments/${commentId}`, ada.token, {
          text: "Changed by Ada",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("PATCH", `/projects/${id}/threads/comments/${commentId}`, lena.token, {
          text: "First, edited",
        })
      ).status,
    ).toBe(204);
    expect((await threads(id, ada.token))[0]?.comments[0]).toEqual(
      expect.objectContaining({ text: "First, edited", editedAt: expect.any(String) as string }),
    );
    expect(
      (await call("DELETE", `/projects/${id}/threads/comments/${commentId}`, ada.token)).status,
    ).toBe(204);
    expect(await threads(id, ada.token)).toEqual([]);
  });

  it("attaches only files of the same project, and refuses empty or unknown targets", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const make = async () =>
      (
        (await (
          await call("POST", "/projects", ada.token, { building: exampleHouse("en") })
        ).json()) as { id: string }
      ).id;
    const one = await make();
    const two = await make();
    const res = await fetch(`${base}/projects/${two}/files`, {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        authorization: `Bearer ${ada.token}`,
        "x-file-name": "a.txt",
      },
      body: "x",
    });
    const file = (await res.json()) as { id: string };
    expect(
      (
        await call("POST", `/projects/${one}/threads`, ada.token, {
          target: { kind: "building" },
          text: "see",
          attachments: [file.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", `/projects/${two}/threads`, ada.token, {
          target: { kind: "building" },
          text: "see",
          attachments: [file.id],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await call("POST", `/projects/${one}/threads`, ada.token, {
          target: { kind: "chimney" },
          text: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", `/projects/${one}/threads`, ada.token, {
          target: { kind: "building" },
          text: "   ",
        })
      ).status,
    ).toBe(400);
  });

  it("moves notes kept in the building into threads once, and takes them out of the building", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const building = {
      ...exampleHouse("en"),
      notes: [
        {
          id: "n1",
          target: { kind: "building" },
          text: "Gas boiler from 1998",
          author: "Lena 42",
          createdAt: "2026-09-20T10:00:00.000Z",
        },
        {
          id: "n2",
          target: { kind: "wall", wallIndex: 1 },
          text: "Crack",
          author: "Tom",
          createdAt: "2026-09-21T10:00:00.000Z",
          done: true,
        },
      ],
    };
    const { id } = (await (await call("POST", "/projects", ada.token, { building })).json()) as {
      id: string;
    };
    await app.get(ThreadsService).onModuleInit();
    await app.get(ThreadsService).onModuleInit();
    const list = await threads(id, ada.token);
    expect(
      list.map((t) => [t.comments[0]?.text, t.comments[0]?.authorName, t.resolvedAt !== null]),
    ).toEqual([
      ["Gas boiler from 1998", "Lena 42", false],
      ["Crack", "Tom", true],
    ]);
    const project = (await (await call("GET", `/projects/${id}`, ada.token)).json()) as {
      building: { notes?: unknown[] };
      version: number;
    };
    expect(project.building.notes ?? []).toEqual([]);
    expect(project.version).toBe(2);
  });
});
