import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { Pool } from "pg";
import type { INestApplication } from "@nestjs/common";
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { DatabaseStore } from "../files/store";
import { createApp } from "../app";
import { resetLimits } from "../auth/auth.service";
import { resetSearchLimit } from "../users/users.controller";

/**
 * Working on one project together (TODO Part 21, CB): finding people, inviting them, roles,
 * handing over the project, leaving, asking for access, and the inbox that tells each person.
 */
const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";
const SECRET = "a-test-secret-that-is-long-enough-for-hs256-0123456789";

let pool: Pool;
let app: INestApplication;
let base: string;
const sockets: Socket[] = [];

const person = (firstName: string, lastName: string, username: string) => ({
  firstName,
  lastName,
  username,
  password: "Analytical-Engine1",
  confirmPassword: "Analytical-Engine1",
});

const call = (method: string, path: string, bearer?: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface Session {
  token: string;
  user: { id: string };
}

async function signUp(account: ReturnType<typeof person>): Promise<Session> {
  const res = await call("POST", "/auth/sign-up", undefined, account);
  expect(res.status).toBe(201);
  return (await res.json()) as Session;
}

async function project(owner: Session): Promise<string> {
  const res = await call("POST", "/projects", owner.token, { building: exampleHouse("en") });
  return ((await res.json()) as { id: string }).id;
}

const inbox = async (who: Session) =>
  (await (await call("GET", "/notifications", who.token)).json()) as {
    items: {
      id: string;
      kind: string;
      projectId: string;
      projectName: string | null;
      count: number;
      payload: object;
    }[];
    unread: number;
  };

beforeAll(async () => {
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, {
    logger: false,
    files: new DatabaseStore(pool),
    auth: { mode: "on", secret: new TextEncoder().encode(SECRET) },
  });
  await app.listen(0);
  base = `http://127.0.0.1:${String(((app.getHttpServer() as Server).address() as { port: number }).port)}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  resetIds();
  resetLimits();
  resetSearchLimit();
  await pool.query("TRUNCATE app.projects, app.users CASCADE");
});

describe("finding people", () => {
  it("by the start of a username or a name, never oneself, at most 8, with nothing but names", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    await signUp(person("Lena", "Berg", "lena_berg"));
    await signUp(person("Leon", "Krause", "leon_k"));
    const search = async (q: string) =>
      (await (await call("GET", `/users/search?q=${encodeURIComponent(q)}`, ada.token)).json()) as {
        username: string;
      }[];
    expect((await search("le")).map((u) => u.username)).toEqual(["lena_berg", "leon_k"]);
    expect((await search("Krau")).map((u) => u.username)).toEqual(["leon_k"]);
    expect((await search("lena b")).map((u) => u.username)).toEqual(["lena_berg"]);
    expect(await search("ada")).toEqual([]);
    // LIKE wildcards are plain characters.
    expect(await search("%%")).toEqual([]);
    expect(await search("__")).toEqual([]);
    const [first] = await search("lena");
    expect(Object.keys(first ?? {}).sort()).toEqual(["firstName", "id", "lastName", "username"]);
    expect((await call("GET", "/users/search?q=l", ada.token)).status).toBe(400);
    expect((await call("GET", "/users/search?q=lena")).status).toBe(401);
  });
});

describe("members", () => {
  it("the owner invites by account with a role; the invited person sees it at once and is told", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    // Nobody but the owner invites, and nobody is invited as owner.
    expect(
      (
        await call("POST", `/projects/${id}/members`, lena.token, {
          userId: lena.user.id,
          role: "editor",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("POST", `/projects/${id}/members`, ada.token, {
          userId: lena.user.id,
          role: "owner",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", `/projects/${id}/members`, ada.token, {
          userId: lena.user.id,
          role: "editor",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call("POST", `/projects/${id}/members`, ada.token, {
          userId: lena.user.id,
          role: "viewer",
        })
      ).status,
    ).toBe(409);
    expect((await call("GET", `/projects/${id}`, lena.token)).status).toBe(200);
    const members = (await (await call("GET", `/projects/${id}/members`, lena.token)).json()) as {
      username: string;
      role: string;
    }[];
    expect(members.map((m) => [m.username, m.role])).toEqual([
      ["ada_l", "owner"],
      ["lena_berg", "editor"],
    ]);
    const box = await inbox(lena);
    expect(box.unread).toBe(1);
    expect(box.items[0]).toEqual(expect.objectContaining({ kind: "invited", projectId: id }));
    // The owner is not told about her own invitation.
    expect((await inbox(ada)).unread).toBe(0);
  });

  it("changes roles, hands the project over, lets members leave, but never removes the owner", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const tom = await signUp(person("Tom", "Wagner", "tom_w"));
    const id = await project(ada);
    for (const who of [lena, tom])
      await call("POST", `/projects/${id}/members`, ada.token, {
        userId: who.user.id,
        role: "editor",
      });

    expect(
      (
        await call("PATCH", `/projects/${id}/members/${lena.user.id}`, ada.token, {
          role: "viewer",
        })
      ).status,
    ).toBe(204);
    expect(
      (await call("POST", `/projects/${id}/ops`, lena.token, { clientId: "l", seq: 1, ops: [] }))
        .status,
    ).toBe(403);
    expect((await call("DELETE", `/projects/${id}/members/${ada.user.id}`, ada.token)).status).toBe(
      409,
    );
    expect(
      (await call("DELETE", `/projects/${id}/members/${tom.user.id}`, lena.token)).status,
    ).toBe(403);

    // Handing over: Lena owns it, Ada is an editor, and only Lena may delete it now.
    expect(
      (await call("PATCH", `/projects/${id}/members/${lena.user.id}`, ada.token, { role: "owner" }))
        .status,
    ).toBe(204);
    expect((await call("GET", `/projects/${id}/link`, ada.token)).status).toBe(403);
    expect((await call("DELETE", `/projects/${id}`, ada.token)).status).toBe(403);

    // Tom leaves on his own; he is not told about it.
    expect((await call("DELETE", `/projects/${id}/members/${tom.user.id}`, tom.token)).status).toBe(
      204,
    );
    expect((await call("GET", `/projects/${id}`, tom.token)).status).toBe(403);
    expect((await inbox(tom)).items.map((n) => n.kind)).toEqual(["invited"]);
    expect((await call("DELETE", `/projects/${id}`, lena.token)).status).toBe(204);
  });

  it("a removed person's open tab is told at once and its edits stop", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });
    const socket = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: lena.token });
      },
    });
    sockets.push(socket);
    const joined = (await socket.emitWithAck("join", {
      projectId: id,
      clientId: "tab",
      actor: "x",
      color: "#123456",
    })) as { role: string };
    expect(joined.role).toBe("editor");
    const told = new Promise<{ role: string | null }>((resolve) => {
      socket.on("access", resolve);
    });
    await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token);
    expect(await told).toEqual({ projectId: id, role: null });
    expect(await socket.emitWithAck("ops", { seq: 1, ops: [] })).toEqual({
      ok: false,
      reason: "notJoined",
    });
  });
});

describe("a removed person", () => {
  it("cannot come back by the share link until invited again or the link is reset", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    const setLink = async (reset: boolean) =>
      (
        (await (
          await call("PUT", `/projects/${id}/link`, ada.token, { role: "viewer", reset })
        ).json()) as { link: { token: string } }
      ).link.token;
    const join = async (link: string) =>
      (await call("POST", `/projects/${id}/join`, lena.token, { link })).status;
    const link = await setLink(false);
    expect(await join(link)).toBe(200);
    expect(
      (await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token)).status,
    ).toBe(204);
    expect(await join(link)).toBe(403);
    expect((await call("GET", `/projects/${id}`, lena.token)).status).toBe(403);

    // Invited again, she is back; removed once more, a new link lets her in again.
    expect(
      (
        await call("POST", `/projects/${id}/members`, ada.token, {
          userId: lena.user.id,
          role: "viewer",
        })
      ).status,
    ).toBe(204);
    expect((await call("GET", `/projects/${id}`, lena.token)).status).toBe(200);
    await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token);
    expect(await join(link)).toBe(403);
    expect(await join(await setLink(true))).toBe(200);
  });

  it("keeps the project's name in the inbox as it was, not the later renames", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    const name = (
      (await (await call("GET", `/projects/${id}`, ada.token)).json()) as { name: string }
    ).name;
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });
    await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token);
    const rename = {
      clientId: "ada",
      seq: 1,
      ops: [{ op: "set", path: ["name"], value: "Secret" }],
    };
    expect((await call("POST", `/projects/${id}/ops`, ada.token, rename)).status).toBe(200);
    const box = await inbox(lena);
    expect(box.items.map((n) => [n.kind, n.projectName])).toEqual([
      ["removed", name],
      ["invited", name],
    ]);
  });
});

describe("asking for access", () => {
  it("tells the owner once per person, and letting in or declining answers it", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const leon = await signUp(person("Leon", "Krause", "leon_k"));
    const id = await project(ada);
    expect(
      (
        await call("POST", `/projects/${id}/access-requests`, leon.token, {
          message: "Client's architect",
        })
      ).status,
    ).toBe(204);
    expect((await call("POST", `/projects/${id}/access-requests`, leon.token, {})).status).toBe(
      204,
    );
    const box = await inbox(ada);
    expect(box.items).toEqual([
      expect.objectContaining({ kind: "accessRequested", projectId: id, count: 2 }),
    ]);
    expect((await call("GET", `/projects/${id}/access-requests`, leon.token)).status).toBe(403);
    const requests = (await (
      await call("GET", `/projects/${id}/access-requests`, ada.token)
    ).json()) as { userId: string }[];
    expect(requests.map((r) => r.userId)).toEqual([leon.user.id]);

    expect(
      (
        await call("POST", `/projects/${id}/access-requests/${leon.user.id}`, ada.token, {
          role: "commenter",
        })
      ).status,
    ).toBe(204);
    expect(await (await call("GET", `/projects/${id}`, leon.token)).json()).toEqual(
      expect.objectContaining({ role: "commenter" }),
    );
    expect((await inbox(leon)).items[0]).toEqual(
      expect.objectContaining({ kind: "accessGranted" }),
    );
    // A member has nothing to ask for.
    expect((await call("POST", `/projects/${id}/access-requests`, leon.token, {})).status).toBe(
      409,
    );
  });

  it("marks inbox items read, one by one or all, only one's own", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    for (const id of [await project(ada), await project(ada)])
      await call("POST", `/projects/${id}/members`, ada.token, {
        userId: lena.user.id,
        role: "viewer",
      });
    const box = await inbox(lena);
    expect(box.unread).toBe(2);
    const [first] = box.items;
    // Ada cannot mark Lena's items.
    await call("POST", "/notifications/read", ada.token, { ids: [first?.id] });
    expect((await inbox(lena)).unread).toBe(2);
    await call("POST", "/notifications/read", lena.token, { ids: [first?.id] });
    expect((await inbox(lena)).unread).toBe(1);
    await call("POST", "/notifications/read", lena.token, { all: true });
    expect((await inbox(lena)).unread).toBe(0);
    expect((await call("POST", "/notifications/read", lena.token, { ids: ["x"] })).status).toBe(
      400,
    );
  });
});

describe("presence", () => {
  const connect = (who: Session) => {
    const socket = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: who.token });
      },
    });
    sockets.push(socket);
    return socket;
  };
  interface Entry {
    userId: string;
    state: string;
    page: string | null;
    storeyId: string | null;
  }
  const nextPresence = (socket: Socket, test: (actors: Entry[]) => boolean) =>
    new Promise<Entry[]>((resolve) => {
      const on = ({ actors }: { actors: Entry[] }) => {
        if (!test(actors)) return;
        socket.off("presence", on);
        resolve(actors);
      };
      socket.on("presence", on);
    });

  it("shows each person with page, storey and away, lists who is in a project, and remembers when they left", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });

    const adaTab = connect(ada);
    await adaTab.emitWithAck("join", {
      projectId: id,
      clientId: "a",
      actor: "x",
      color: "#123456",
      page: "editor",
    });
    const lenaTab = connect(lena);
    const both = nextPresence(adaTab, (actors) => actors.length === 2);
    await lenaTab.emitWithAck("join", {
      projectId: id,
      clientId: "l",
      actor: "x",
      color: "#123456",
      page: "variants",
      storeyId: "storey-1",
    });
    const actors = await both;
    expect(actors.find((a) => a.userId === lena.user.id)).toEqual(
      expect.objectContaining({ state: "here", page: "variants", storeyId: "storey-1" }),
    );

    const away = nextPresence(adaTab, (list) =>
      list.some((a) => a.userId === lena.user.id && a.state === "away"),
    );
    lenaTab.emit("status", { state: "away", page: "variants", storeyId: "storey-1" });
    await away;

    // The Projects page: Ada sees Lena in it (away), never herself.
    const cards = (await (await call("GET", "/projects", ada.token)).json()) as {
      id: string;
      here: { userId: string; state: string }[];
      lastSeenAt: string | null;
    }[];
    expect(cards[0]?.here).toEqual([
      expect.objectContaining({ userId: lena.user.id, state: "away" }),
    ]);
    expect(cards[0]?.lastSeenAt).toBeNull();

    // Lena closes her tab: Ada's list shrinks, and Lena's last visit is written.
    const alone = nextPresence(adaTab, (list) => list.length === 1);
    lenaTab.disconnect();
    await alone;
    await new Promise((r) => setTimeout(r, 100));
    const lenaCards = (await (await call("GET", "/projects", lena.token)).json()) as {
      lastSeenAt: string | null;
    }[];
    expect(lenaCards[0]?.lastSeenAt).not.toBeNull();
  });
});

describe("live notifications", () => {
  it("reach the person's socket on any page, without joining a project", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    const socket = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: lena.token });
      },
    });
    sockets.push(socket);
    await new Promise<void>((resolve) =>
      socket.on("connect", () => {
        resolve();
      }),
    );
    const arrived = new Promise<{ kind: string; projectId: string }>((resolve) => {
      socket.on("notification", resolve);
    });
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "viewer",
    });
    expect(await arrived).toEqual(expect.objectContaining({ kind: "invited", projectId: id }));
  });
});

describe("history", () => {
  it("lists versions with their author and what they did, names versions, and tells the others quietly", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const tom = await signUp(person("Tom", "Wagner", "tom_w"));
    const id = await project(ada);
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: tom.user.id,
      role: "viewer",
    });
    const before = (await (await call("GET", `/projects/${id}`, ada.token)).json()) as {
      building: { storeys: { id: string }[] };
    };
    const storey = before.building.storeys[0]?.id ?? "";
    const door = {
      id: "door-1",
      kind: "door",
      wallIndex: 1,
      offset: 1,
      width: 1,
      height: 2.1,
      sill: 0,
      constructionId: "c_door_old",
    };
    const batch = {
      clientId: "lena-tab",
      seq: 1,
      ops: [
        { op: "insert", path: ["storeys", { id: storey }, "openings"], value: door, after: null },
      ],
    };
    expect((await call("POST", `/projects/${id}/ops`, lena.token, batch)).status).toBe(200);

    const versions = (await (await call("GET", `/projects/${id}/versions`, tom.token)).json()) as {
      version: number;
      actorId: string | null;
      summary: Record<string, { added: number }>;
    }[];
    expect(versions[0]).toEqual(expect.objectContaining({ version: 2, actorId: lena.user.id }));
    expect(versions[0]?.summary.doors?.added).toBe(1);

    // Viewers do not name versions; editors do, and the others hear of it without a badge.
    expect((await call("POST", `/projects/${id}/named`, tom.token, { name: "x" })).status).toBe(
      403,
    );
    expect(
      (await call("POST", `/projects/${id}/named`, lena.token, { name: "Survey done", version: 9 }))
        .status,
    ).toBe(400);
    const named = (await (
      await call("POST", `/projects/${id}/named`, lena.token, { name: "Survey done" })
    ).json()) as { id: string; version: number };
    expect(named.version).toBe(2);
    const tomBox = (await (await call("GET", "/notifications", tom.token)).json()) as {
      items: { kind: string }[];
      unread: number;
    };
    expect(tomBox.items.map((n) => n.kind)).toContain("versionNamed");
    expect(tomBox.unread).toBe(1); // only the invitation counts
    expect((await inbox(ada)).items.map((n) => n.kind)).toContain("versionNamed");
    expect((await inbox(lena)).items.map((n) => n.kind)).not.toContain("versionNamed");
    expect(
      (
        await call("PATCH", `/projects/${id}/named/${named.id}`, ada.token, {
          name: "Survey done, checked",
        })
      ).status,
    ).toBe(204);
    const list = (await (await call("GET", `/projects/${id}/named`, tom.token)).json()) as {
      name: string;
      namedBy: { firstName: string };
    }[];
    expect(list).toEqual([
      expect.objectContaining({
        name: "Survey done, checked",
        namedBy: expect.objectContaining({ firstName: "Lena" }) as object,
      }),
    ]);
    expect((await call("DELETE", `/projects/${id}/named/${named.id}`, lena.token)).status).toBe(
      204,
    );
    expect(await (await call("GET", `/projects/${id}/named`, tom.token)).json()).toEqual([]);
  });

  it("tells a tab on joining when its person was last in the project", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const id = await project(ada);
    const first = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: ada.token });
      },
    });
    sockets.push(first);
    const one = (await first.emitWithAck("join", {
      projectId: id,
      clientId: "a",
      actor: "x",
      color: "#123456",
    })) as { lastSeenAt: string | null };
    expect(one.lastSeenAt).toBeNull();
    first.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    const second = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: ada.token });
      },
    });
    sockets.push(second);
    const two = (await second.emitWithAck("join", {
      projectId: id,
      clientId: "b",
      actor: "x",
      color: "#123456",
    })) as { lastSeenAt: string | null };
    expect(two.lastSeenAt).not.toBeNull();
  });
});

describe("a viewer", () => {
  it("cannot hold an opening with a drag or announce an activity", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const tom = await signUp(person("Tom", "Wagner", "tom_w"));
    const id = await project(ada);
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: tom.user.id,
      role: "viewer",
    });
    const open = async (who: Session, clientId: string) => {
      const socket = io(base, {
        transports: ["websocket"],
        forceNew: true,
        auth: (cb) => {
          cb({ token: who.token });
        },
      });
      sockets.push(socket);
      const received: string[] = [];
      socket.onAny((event: string) => {
        received.push(event);
      });
      await socket.emitWithAck("join", { projectId: id, clientId, actor: "x", color: "#123456" });
      return { socket, received };
    };
    const owner = await open(ada, "ada");
    const viewer = await open(tom, "tom");
    viewer.socket.emit("drag", { dragging: { storeyId: "s1", id: "o1", offset: 1 } });
    viewer.socket.emit("activity", { activity: { kind: "restore", version: 1 } });
    // A selection is allowed and comes after both, in order, so its arrival means they were handled.
    viewer.socket.emit("selection", { selection: { kind: "roof" } });
    for (let i = 0; i < 100 && !owner.received.includes("selection"); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(owner.received).toContain("selection");
    expect(owner.received).not.toContain("drag");
    expect(owner.received).not.toContain("activity");
  });
});

describe("a removed editor", () => {
  it("cannot keep editing after a refused join to another project left the socket outside the room", async () => {
    const ada = await signUp(person("Ada", "Lovelace", "ada_l"));
    const lena = await signUp(person("Lena", "Berg", "lena_berg"));
    const id = await project(ada);
    const other = await project(ada);
    await call("POST", `/projects/${id}/members`, ada.token, {
      userId: lena.user.id,
      role: "editor",
    });
    const tab = io(base, {
      transports: ["websocket"],
      forceNew: true,
      auth: (cb) => {
        cb({ token: lena.token });
      },
    });
    sockets.push(tab);
    const join = (projectId: string) =>
      tab.emitWithAck("join", {
        projectId,
        clientId: "lena",
        actor: "x",
        color: "#123456",
      }) as Promise<{
        ok: boolean;
      }>;
    expect((await join(id)).ok).toBe(true);
    // Lena has no access to the other project: the join is refused.
    expect((await join(other)).ok).toBe(false);
    expect(
      (await call("DELETE", `/projects/${id}/members/${lena.user.id}`, ada.token)).status,
    ).toBe(204);
    const rename = { op: "set", path: ["name"], value: "Taken over" };
    const ack = (await tab.emitWithAck("ops", { seq: 1, ops: [rename] })) as { ok: boolean };
    expect(ack.ok).toBe(false);
    const after = (await (await call("GET", `/projects/${id}`, ada.token)).json()) as {
      building: { name: string };
    };
    expect(after.building.name).not.toBe("Taken over");
  });
});
