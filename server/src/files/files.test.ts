import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createApp } from "../app";
import { resetLimits } from "../auth/auth.service";
import { FilesService } from "./files.service";
import { DatabaseStore } from "./store";

/** A project's files (TODO Part 21, CD): who may do what, what is refused, slots, cleanup. */
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

const json = (method: string, path: string, bearer: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const upload = (
  path: string,
  bearer: string,
  data: Uint8Array,
  type: string,
  extra: Record<string, string> = {},
) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": type, authorization: `Bearer ${bearer}`, ...extra },
    body: data,
  });

async function signUp(account: ReturnType<typeof person>) {
  const res = await fetch(`${base}/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(account),
  });
  return (await res.json()) as { token: string; user: { id: string } };
}

const blobs = async () =>
  (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.file_blobs")).rows[0]?.n;

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

describe("project files", () => {
  it("editors upload, everyone with access reads, strangers and viewers do neither or only read", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const lena = await signUp(person("Lena", "lena_b"));
    const tom = await signUp(person("Tom", "tom_w"));
    const created = await json("POST", "/projects", ada.token, { building: exampleHouse("en") });
    const { id } = (await created.json()) as { id: string };
    await json("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "viewer",
    });

    const pdf = new TextEncoder().encode("%PDF-1.4 a plan");
    const name = encodeURIComponent("Bauakte Methfesselstraße 8.pdf");
    const added = await upload(`/projects/${id}/files`, ada.token, pdf, "application/pdf", {
      "x-file-name": name,
    });
    expect(added.status).toBe(201);
    const file = (await added.json()) as { id: string; name: string; size: number };
    expect(file).toEqual(
      expect.objectContaining({ name: "Bauakte Methfesselstraße 8.pdf", size: pdf.length }),
    );

    // A viewer lists and reads, but uploads and deletes nothing; a stranger gets nothing.
    expect(
      ((await (await json("GET", `/projects/${id}/files`, lena.token)).json()) as unknown[]).length,
    ).toBe(1);
    const read = await fetch(`${base}/projects/${id}/files/${file.id}`, {
      headers: { authorization: `Bearer ${lena.token}` },
    });
    expect(read.headers.get("content-type")).toContain("application/pdf");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(pdf);
    expect(
      (
        await upload(`/projects/${id}/files`, lena.token, pdf, "application/pdf", {
          "x-file-name": "x.pdf",
        })
      ).status,
    ).toBe(403);
    expect((await json("DELETE", `/projects/${id}/files/${file.id}`, lena.token)).status).toBe(403);
    expect((await json("GET", `/projects/${id}/files`, tom.token)).status).toBe(403);
    expect(
      (
        await fetch(`${base}/projects/${id}/files/${file.id}`, {
          headers: { authorization: `Bearer ${tom.token}` },
        })
      ).status,
    ).toBe(403);
  });

  it("refuses scripts, empty files and files without a name", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    const bytes = new TextEncoder().encode("<svg onload=alert(1)>");
    for (const type of ["image/svg+xml", "text/html"]) {
      expect(
        (await upload(`/projects/${id}/files`, ada.token, bytes, type, { "x-file-name": "a" }))
          .status,
      ).not.toBe(201);
    }
    expect(
      (
        await upload(`/projects/${id}/files`, ada.token, new Uint8Array(), "text/plain", {
          "x-file-name": "a.txt",
        })
      ).status,
    ).toBe(400);
    expect((await upload(`/projects/${id}/files`, ada.token, bytes, "text/plain")).status).toBe(
      400,
    );
    expect(await blobs()).toBe(0);
  });

  it("a new picture in a slot replaces the old one, and deleting the project deletes every file", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    const one = new Uint8Array([1, 2, 3]);
    const two = new Uint8Array([4, 5, 6, 7]);
    const put = (data: Uint8Array) =>
      fetch(`${base}/projects/${id}/photos/3`, {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          authorization: `Bearer ${ada.token}`,
          "x-width": "10",
          "x-height": "8",
        },
        body: data,
      });
    expect((await put(one)).status).toBe(204);
    expect((await put(two)).status).toBe(204);
    expect(await blobs()).toBe(1);
    const photos = (await (await json("GET", `/projects/${id}/photos`, ada.token)).json()) as {
      slot: string;
      width: number;
    }[];
    expect(photos).toEqual([expect.objectContaining({ slot: "3", width: 10 })]);
    const got = await fetch(`${base}/projects/${id}/photos/3`, {
      headers: { authorization: `Bearer ${ada.token}` },
    });
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(two);
    await upload(`/projects/${id}/files`, ada.token, one, "text/plain", {
      "x-file-name": "note.txt",
    });
    expect(await blobs()).toBe(2);
    expect((await json("DELETE", `/projects/${id}`, ada.token)).status).toBe(204);
    expect(await blobs()).toBe(0);
  });

  it("moves pictures stored before files existed into their slots, once", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    await pool.query(
      `INSERT INTO app.project_photos (project_id, slot, mime, width, height, data)
       VALUES ($1, 'thumbnail', 'image/jpeg', 4, 3, $2)`,
      [id, Buffer.from([9, 9, 9])],
    );
    await app.get(FilesService).onModuleInit();
    await app.get(FilesService).onModuleInit();
    const files = (await (await json("GET", `/projects/${id}/files`, ada.token)).json()) as {
      slot: string;
    }[];
    expect(files.map((f) => f.slot)).toEqual(["thumbnail"]);
    expect((await pool.query("SELECT 1 FROM app.project_photos")).rowCount).toBe(0);
  });
});

describe("parallel uploads to one slot", () => {
  it("all succeed, one after the other, and the slot keeps exactly one file", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    const put = (n: number) =>
      fetch(`${base}/projects/${id}/photos/2`, {
        method: "PUT",
        headers: {
          "content-type": "image/jpeg",
          authorization: `Bearer ${ada.token}`,
          "x-width": "10",
          "x-height": "10",
        },
        body: new Uint8Array([n, n, n]),
      });
    const answers = await Promise.all([1, 2, 3, 4, 5].map(put));
    const codes = await Promise.all(
      answers.map(async (r) => `${String(r.status)} ${r.status < 300 ? "" : await r.text()}`),
    );
    expect(codes.filter((c) => !c.startsWith("2"))).toEqual([]);
    const rows = await pool.query(
      "SELECT 1 FROM app.project_files WHERE project_id = $1 AND slot = '2'",
      [id],
    );
    expect(rows.rowCount).toBe(1);
    // The bytes of the replaced uploads are gone too.
    expect(await blobs()).toBe(1);
  });
});

describe("open tabs follow the files", () => {
  it("announces every upload, replacement and removal for the project", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    const heard: string[] = [];
    const files = app.get(FilesService);
    const listen = (projectId: string) => heard.push(projectId);
    files.events.on("changed", listen);
    try {
      const added = await upload(
        `/projects/${id}/files`,
        ada.token,
        new Uint8Array([1]),
        "image/png",
        {
          "x-file-name": "wall.png",
        },
      );
      const { id: fileId } = (await added.json()) as { id: string };
      expect(heard).toEqual([id]);
      await json("DELETE", `/projects/${id}/files/${fileId}`, ada.token);
      expect(heard).toEqual([id, id]);
    } finally {
      files.events.off("changed", listen);
    }
  });
});

describe("switching on storage", () => {
  it("moves files kept in the table into the storage, once", async () => {
    const ada = await signUp(person("Ada", "ada_l"));
    const { id } = (await (
      await json("POST", "/projects", ada.token, { building: exampleHouse("en") })
    ).json()) as { id: string };
    await upload(`/projects/${id}/files`, ada.token, new Uint8Array([1, 2]), "text/plain", {
      "x-file-name": "a.txt",
    });
    expect(await blobs()).toBe(1);
    const stored = new Map<string, Buffer>();
    const storage = {
      kind: "supabase" as const,
      put: (key: string, data: Buffer) => {
        stored.set(key, data);
        return Promise.resolve();
      },
      get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      remove: () => Promise.resolve(),
    };
    await new FilesService(pool, storage).onModuleInit();
    expect(await blobs()).toBe(0);
    expect([...stored.values()]).toEqual([Buffer.from([1, 2])]);
  });
});
