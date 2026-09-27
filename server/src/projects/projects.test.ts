import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { exampleHouse, exampleTower } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import type { Building } from "@/geometry/types";
import type { Op } from "@/sync/ops";
import { createApp } from "../app";
import { ProjectsService } from "./projects.service";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";

let pool: Pool;
let app: INestApplication;
let service: ProjectsService;
let base: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, { logger: false });
  await app.listen(0);
  const address = (app.getHttpServer() as Server).address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
  service = app.get(ProjectsService);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  resetIds();
  await pool.query("TRUNCATE project_events, projects");
});

const house = (): Building => exampleHouse("en");

const json = (method: string, path: string, body?: unknown, actor = "tester") =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-actor": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function createHouse(): Promise<{ id: string; building: Building }> {
  const created = await service.create(house(), "setup");
  if (!created.ok) throw new Error("create failed");
  return { id: created.project.id, building: created.project.building };
}

/** Path to a field of the ground floor's opening number `index`. */
function openingPath(b: Building, index: number, field: string): Op["path"] {
  const storey = b.storeys[0];
  const opening = storey?.openings[index];
  if (!storey || !opening) throw new Error("fixture");
  return ["storeys", { id: storey.id }, "openings", { id: opening.id }, field];
}

describe("REST", () => {
  it("answers the health check while the database answers", async () => {
    const res = await json("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("creates, reads, lists and deletes a project", async () => {
    const created = await json("POST", "/projects", { building: house() });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string; version: number; name: string };
    expect(project.version).toBe(1);
    expect(project.name).toBe("Family house");

    const got = await json("GET", `/projects/${project.id}`);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { building: Building }).building.storeys).toHaveLength(2);

    const list = (await (await json("GET", "/projects")).json()) as { id: string }[];
    expect(list.map((p) => p.id)).toEqual([project.id]);

    expect((await json("DELETE", `/projects/${project.id}`)).status).toBe(204);
    expect((await json("GET", `/projects/${project.id}`)).status).toBe(404);
  });

  it("rejects an invalid building with 422 and the geometry error", async () => {
    const b = house();
    b.storeys[0]!.openings[1]!.offset = 4; // 4 to 5.2 overlaps the door at 4.5 to 5.5
    const res = await json("POST", "/projects", { building: b });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { detail: { code: string } };
    expect(body.detail.code).toBe("openingsOverlap");
  });

  it("rejects a missing building cleanly and accepts a valid body over 100 KB", async () => {
    const missing = await json("POST", "/projects", {});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "buildingRequired" });

    const tower = exampleTower("en");
    expect(JSON.stringify({ building: tower }).length).toBeGreaterThan(100_000);
    const large = await json("POST", "/projects", { building: tower });
    expect(large.status).toBe(201);
  });

  it("applies a batch of operations, and refuses malformed ones", async () => {
    const { id, building } = await createHouse();
    const ops: Op[] = [{ op: "set", path: ["wallThickness"], value: 0.4 }];
    const ok = await json("POST", `/projects/${id}/ops`, { clientId: "tab-1", seq: 1, ops });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, version: 2 });
    expect((await service.get(id))?.building.wallThickness).toBe(0.4);

    const malformed = await json("POST", `/projects/${id}/ops`, {
      clientId: "tab-1",
      seq: 2,
      ops: [{ op: "set", path: ["__proto__", "x"], value: 1 }],
    });
    expect(malformed.status).toBe(400);

    const breaking = await json("POST", `/projects/${id}/ops`, {
      clientId: "tab-1",
      seq: 3,
      ops: [{ op: "set", path: openingPath(building, 1, "offset"), value: 4 }],
    });
    expect(breaking.status).toBe(422);
    expect(((await breaking.json()) as { detail: { code: string } }).detail.code).toBe(
      "openingsOverlap",
    );
    expect((await service.get(id))?.version).toBe(2);

    // The same state is accepted when the sender's own building was invalid already: the
    // editor shows invalid openings instead of refusing them.
    const seenInvalid = await json("POST", `/projects/${id}/ops`, {
      clientId: "tab-1",
      seq: 4,
      valid: false,
      ops: [{ op: "set", path: openingPath(building, 1, "offset"), value: 4 }],
    });
    expect(seenInvalid.status).toBe(200);
    expect((await service.get(id))?.version).toBe(3);

    expect(
      (await json("POST", `/projects/missing/ops`, { clientId: "t", seq: 1, ops })).status,
    ).toBe(404);
  });
});

describe("batches", () => {
  it("applies many simultaneous batches one after another, each exactly once", async () => {
    const { id, building } = await createHouse();
    // Twelve tabs each move their own window field at the same moment.
    const fields = ["offset", "width", "height", "sill"] as const;
    const writers = Array.from({ length: 12 }, (_, i) => {
      const index = i % 2;
      const field = fields[Math.floor(i / 3) % fields.length] ?? "width";
      const current = building.storeys[0]?.openings[index]?.[field] ?? 0;
      return service.applyBatch(
        id,
        {
          clientId: `tab-${i}`,
          valid: true,
          seq: 1,
          ops: [
            { op: "set", path: ["name"], value: `Name ${i}` },
            { op: "set", path: openingPath(building, index, field), value: current },
          ],
        },
        `writer-${i}`,
      );
    });
    const results = await Promise.all(writers);
    expect(results.every((r) => r.ok)).toBe(true);
    const versions = results.map((r) => (r.ok ? r.version : 0)).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: 12 }, (_, i) => i + 2));
    const after = await service.get(id);
    expect(after?.version).toBe(13);
    expect(await service.eventCount(id)).toBe(13);
    // The last batch to commit named the building.
    const last = results.findIndex((r) => r.ok && r.version === 13);
    expect(after?.name).toBe(`Name ${last}`);
  });

  it("applies a resent batch once and acknowledges it again", async () => {
    const { id } = await createHouse();
    const batch = {
      clientId: "tab-1",
      seq: 1,
      valid: true,
      ops: [{ op: "set", path: ["wallThickness"], value: 0.35 }] as Op[],
    };
    const first = await service.applyBatch(id, batch, "a");
    const again = await service.applyBatch(id, batch, "a");
    expect(first).toMatchObject({ ok: true, version: 2, duplicate: false });
    expect(again).toMatchObject({ ok: true, version: 2, duplicate: true });
    expect((await service.get(id))?.version).toBe(2);
    expect(await service.lastSeq(id, "tab-1")).toBe(1);
    expect(await service.lastSeq(id, "tab-2")).toBe(0);
  });

  it("drops an edit to an opening someone deleted and keeps the rest of the batch", async () => {
    const { id, building } = await createHouse();
    const storey = building.storeys[0];
    const opening = storey?.openings[0];
    if (!storey || !opening) throw new Error("fixture");
    await service.applyBatch(
      id,
      {
        clientId: "alice",
        valid: true,
        seq: 1,
        ops: [{ op: "remove", path: ["storeys", { id: storey.id }, "openings"], id: opening.id }],
      },
      "alice",
    );
    const result = await service.applyBatch(
      id,
      {
        clientId: "bob",
        valid: true,
        seq: 1,
        ops: [
          { op: "set", path: openingPath(building, 0, "width"), value: 1.1 },
          { op: "set", path: ["wallThickness"], value: 0.36 },
        ],
      },
      "bob",
    );
    expect(result).toMatchObject({ ok: true, dropped: 1 });
    expect((await service.get(id))?.building.wallThickness).toBe(0.36);
    const event = await pool.query<{ patch: { ops: Op[] } }>(
      "SELECT patch FROM project_events WHERE project_id = $1 AND client_id = 'bob'",
      [id],
    );
    expect(event.rows[0]?.patch.ops).toHaveLength(1);
  });
});

describe("versions", () => {
  it("lists every version newest first and rebuilds any of them", async () => {
    const { id, building } = await createHouse();
    const path = openingPath(building, 1, "offset");
    for (const [seq, offset] of [0.5, 0.8, 1.1].entries()) {
      await service.applyBatch(
        id,
        { clientId: "tab", seq: seq + 1, valid: true, ops: [{ op: "set", path, value: offset }] },
        seq === 1 ? "Bob" : "Ada",
      );
    }
    const list = (await (await json("GET", `/projects/${id}/versions`)).json()) as {
      version: number;
      actor: string;
      kind: string;
      changes: number;
    }[];
    expect(list.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(list[0]).toMatchObject({ actor: "Ada", kind: "ops", changes: 1 });
    expect(list[3]).toMatchObject({ kind: "create", changes: 0 });

    const offsetAt = async (version: number) => {
      const res = await json("GET", `/projects/${id}/versions/${version}`);
      const body = (await res.json()) as { building: Building };
      return body.building.storeys[0]?.openings[1]?.offset;
    };
    expect(await offsetAt(1)).toBe(building.storeys[0]?.openings[1]?.offset);
    expect(await offsetAt(3)).toBe(0.8);
    expect(await offsetAt(4)).toBe(1.1);
    expect((await json("GET", `/projects/${id}/versions/9`)).status).toBe(404);
    expect((await json("GET", `/projects/${id}/versions/x`)).status).toBe(404);
  });
});

describe("Socket.IO", () => {
  const open: Socket[] = [];

  afterAll(() => {
    for (const s of open) s.disconnect();
  });

  /** A connected tab that records every message it gets. */
  async function tab(projectId: string, clientId: string) {
    const socket = io(base, { transports: ["websocket"], forceNew: true });
    open.push(socket);
    const received: { event: string; data: unknown }[] = [];
    socket.onAny((event: string, data: unknown) => {
      received.push({ event, data });
    });
    const joined = (await socket.emitWithAck("join", {
      projectId,
      clientId,
      actor: `Actor ${clientId}`,
      color: "#123456",
    })) as { ok: boolean; version: number; building: Building; lastSeq: number };
    /** The first `event` message that passes `test`, waiting for it when needed. */
    const next = async (event: string, test: (data: unknown) => boolean = () => true) => {
      for (let i = 0; i < 100; i++) {
        const index = received.findIndex((m) => m.event === event && test(m.data));
        if (index >= 0) return received.splice(index, 1)[0]?.data;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no ${event}`);
    };
    return { socket, joined, next, received };
  }

  it("hands a joining tab the building, then sends every batch to the whole room", async () => {
    const { id, building } = await createHouse();
    const a = await tab(id, "a");
    const b = await tab(id, "b");
    expect(a.joined).toMatchObject({ ok: true, version: 1, lastSeq: 0 });
    expect(b.joined.building.id).toBe(building.id);

    const presence = (await b.next("presence")) as { actors: { clientId: string }[] };
    expect(presence.actors.map((x) => x.clientId).sort()).toEqual(["a", "b"]);

    const ops: Op[] = [{ op: "set", path: openingPath(building, 0, "width"), value: 1.3 }];
    const ack = (await a.socket.emitWithAck("ops", { seq: 1, ops })) as {
      ok: boolean;
      version: number;
    };
    expect(ack).toMatchObject({ ok: true, version: 2 });
    for (const t of [a, b]) {
      expect(await t.next("ops")).toMatchObject({ version: 2, clientId: "a", seq: 1, ops });
    }

    // A tab that comes back learns which of its batches the project already has.
    a.socket.disconnect();
    const again = await tab(id, "a");
    expect(again.joined).toMatchObject({ version: 2, lastSeq: 1 });
  });

  it("answers a batch that breaks an invariant with the reason and sends nothing", async () => {
    const { id, building } = await createHouse();
    const a = await tab(id, "a");
    const ack = (await a.socket.emitWithAck("ops", {
      seq: 1,
      ops: [{ op: "set", path: openingPath(building, 1, "offset"), value: 4 }],
    })) as { ok: boolean; reason: string; error: { code: string } };
    expect(ack).toMatchObject({ ok: false, reason: "invalid", error: { code: "openingsOverlap" } });
    expect(a.received.some((m) => m.event === "ops")).toBe(false);
  });

  it("refuses a batch before join and a malformed join", async () => {
    const socket = io(base, { transports: ["websocket"], forceNew: true });
    open.push(socket);
    expect(await socket.emitWithAck("ops", { seq: 1, ops: [] })).toMatchObject({
      ok: false,
      reason: "notJoined",
    });
    expect(await socket.emitWithAck("join", { projectId: "p" })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("passes pointers and drags on to the others, and drops malformed ones", async () => {
    const { id } = await createHouse();
    const a = await tab(id, "a");
    const b = await tab(id, "b");
    a.socket.emit("cursor", { cursor: { x: 1.5, y: -2 } });
    expect(await b.next("cursor")).toEqual({ clientId: "a", cursor: { x: 1.5, y: -2 } });
    a.socket.emit("cursor", { cursor: { x: "far", y: 0 } });
    const dragging = { storeyId: "s1", id: "o1", offset: 2.5 };
    a.socket.emit("drag", { dragging });
    expect(await b.next("drag")).toEqual({ clientId: "a", dragging });
    // The malformed pointer was dropped, not passed on.
    expect(b.received.some((m) => m.event === "cursor")).toBe(false);
    expect(a.received.some((m) => m.event === "drag")).toBe(false);
  });

  it("relays a selection to the others and shows it in the presence list", async () => {
    const { id } = await createHouse();
    const a = await tab(id, "a");
    const b = await tab(id, "b");
    await a.next("presence");
    a.socket.emit("selection", { selection: { kind: "roof" } });
    expect(await b.next("selection")).toEqual({ clientId: "a", selection: { kind: "roof" } });
    b.socket.disconnect();
    const alone = (data: unknown) => (data as { actors: unknown[] }).actors.length === 1;
    const presence = (await a.next("presence", alone)) as { actors: { clientId: string }[] };
    expect(presence.actors.map((x) => x.clientId)).toEqual(["a"]);
  });
});
