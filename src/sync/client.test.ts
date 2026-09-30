import { normalizeWalls } from "@/geometry/wallGraph";
import { beforeEach, describe, expect, it } from "vitest";
import type { Building } from "@/geometry/types";
import { resetIds } from "@/lib/ids";
import { exampleHouse } from "@/lib/examples";
import { createEditorStore } from "@/store/building";
import { SyncClient } from "./client";
import { shareCursor, shareDrag } from "./presence";
import type { Rejection } from "./client";
import { sameJson } from "./ops";
import { TestHub } from "./testHub";
import type { FakeSocket } from "./testHub";

type Store = ReturnType<typeof createEditorStore>;

interface Tab {
  store: Store;
  client: SyncClient;
  socket: FakeSocket;
  rejections: Rejection[];
}

let hub: TestHub;

beforeEach(() => {
  resetIds();
  hub = new TestHub(exampleHouse("en"));
});

/** A connected editor tab with its own store. */
function openTab(name: string): Tab {
  const store = createEditorStore();
  const client = new SyncClient(store, {
    apiUrl: "/collab",
    projectId: "p1",
    actor: name,
    color: "#123456",
    clientId: name,
    connect: hub.connect,
  });
  const rejections: Rejection[] = [];
  client.onReject((r) => rejections.push(r));
  client.start();
  const socket = hub.sockets.at(-1);
  if (!socket) throw new Error("no socket");
  return { store, client, socket, rejections };
}

const ground = (b: Building) =>
  b.storeys[0] ??
  (() => {
    throw new Error("fixture");
  })();
const opening = (b: Building, i: number) =>
  ground(b).openings[i] ??
  (() => {
    throw new Error("fixture");
  })();

/** Moves opening `i` on the ground floor to `offset` in this tab, as the user would. */
function move(tab: Tab, i: number, offset: number) {
  const b = tab.store.getState().building;
  tab.store.getState().updateOpening(ground(b).id, opening(b, i).id, { offset });
}

/** Every tab shows what the server has. */
function expectConverged(...tabs: Tab[]) {
  for (const tab of tabs) {
    expect(tab.client.unconfirmed).toBe(0);
    expect(tab.client.version).toBe(hub.version);
    expect(sameJson(tab.store.getState().building, hub.building)).toBe(true);
  }
}

describe("SyncClient", () => {
  it("shows the other person's pointer and the window they drag, live", () => {
    const b = openTab("b");
    // The page has one pointer, so the sharing channel follows the tab started last.
    const a = openTab("a");
    hub.flush();
    shareCursor({ x: 3, y: 4 });
    hub.flush();
    const seen = () => b.store.getState().presence.find((p) => p.clientId === "a");
    expect(seen()?.cursor).toEqual({ x: 3, y: 4 });

    const building = a.store.getState().building;
    const target = opening(building, 1);
    shareDrag({ storeyId: ground(building).id, id: target.id, offset: 0.4 });
    hub.flush();
    expect(seen()?.dragging).toMatchObject({ id: target.id, offset: 0.4 });

    // The drag ends in a move: the others get the move before the drag lets go.
    const order: string[] = [];
    b.store.subscribe((state, before) => {
      if (state.building !== before.building) order.push("move");
      if (!state.presence[0]?.dragging && before.presence[0]?.dragging) order.push("released");
    });
    move(a, 1, 0.4);
    shareDrag(null);
    hub.receiveAll();
    hub.flush();
    expect(order).toEqual(["move", "released"]);
    expect(opening(b.store.getState().building, 1).offset).toBe(0.4);
    expectConverged(a, b);
  });

  it("opens the project with an empty history and sends a local edit as one batch", () => {
    const a = openTab("a");
    a.store.getState().renameBuilding("Local draft");
    hub.flush();
    expect(a.store.getState().building.name).toBe("Family house");
    expect(a.store.getState().past).toHaveLength(0);
    expect(a.store.getState().projectId).toBe("p1");

    move(a, 1, 0.5);
    expect(a.client.unconfirmed).toBe(1);
    expect(opening(a.store.getState().building, 1).offset).toBe(0.5);
    hub.flush();
    expect(hub.version).toBe(2);
    expect(opening(hub.building, 1).offset).toBe(0.5);
    expectConverged(a);
  });

  it("keeps both edits when two people move different windows at the same moment", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    move(a, 1, 0.5);
    move(b, 2, 8);
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(0.5);
    expect(opening(hub.building, 2).offset).toBe(8);
    expectConverged(a, b);
  });

  it("settles on one value when two people move the same window at the same moment", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    move(a, 1, 0.5);
    move(b, 1, 0.2);
    hub.flush();
    expect([0.5, 0.2]).toContain(opening(hub.building, 1).offset);
    expectConverged(a, b);
  });

  it("takes back an edit that together with another would overlap two windows, and says so", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    // Front wall, 10 m: windows 1.2 m wide at 1 and 7.5, the door at 4.5 to 5.5. Each move
    // alone is valid; together the two windows overlap at 3 to 3.7.
    move(a, 1, 2.5);
    move(b, 2, 3);
    hub.flush();
    const refused = [...a.rejections, ...b.rejections];
    expect(refused).toHaveLength(1);
    expect(refused[0]?.error?.code).toBe("openingsOverlap");
    expectConverged(a, b);
  });

  it("lets your own invalid edit through, as the editor shows it, without a notice", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    // Onto the door: invalid, drawn in the warning colour, but the user's own doing.
    move(a, 1, 4.6);
    hub.flush();
    expect(a.rejections).toEqual([]);
    expect(opening(hub.building, 1).offset).toBe(4.6);
    expectConverged(a, b);
  });

  it("undoes only your own edit and leaves the other person's in place", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    const before = opening(hub.building, 1).offset;
    move(a, 1, 0.5);
    hub.flush();
    move(b, 2, 8);
    hub.flush();
    a.store.getState().undo();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(before);
    expect(opening(hub.building, 2).offset).toBe(8);
    expectConverged(a, b);
    a.store.getState().redo();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(0.5);
    expect(opening(hub.building, 2).offset).toBe(8);
    expectConverged(a, b);
  });

  it("does not undo a field someone else changed after you", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    move(a, 1, 0.5);
    hub.flush();
    move(b, 1, 0.2);
    hub.flush();
    a.store.getState().undo();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(0.2);
    expectConverged(a, b);
  });

  it("shows an old version read only and comes back to live with what happened meanwhile", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    const old = hub.building;
    move(a, 1, 0.5);
    hub.flush();
    const live = hub.version;

    a.client.preview(old);
    expect(opening(a.store.getState().building, 1).offset).toBe(opening(old, 1).offset);
    // Edits made while looking at the old version are not sent.
    move(a, 2, 8.5);
    move(b, 2, 8);
    hub.flush();
    expect(hub.version).toBe(live + 1);
    expect(opening(hub.building, 2).offset).toBe(8);

    a.client.preview(null);
    expectConverged(a, b);
    // Undo still takes back only a's own move, and keeps b's.
    a.store.getState().undo();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(opening(old, 1).offset);
    expect(opening(hub.building, 2).offset).toBe(8);
    expectConverged(a, b);
  });

  it("restores an old version as one new version that undo takes back", () => {
    const a = openTab("a");
    hub.flush();
    const old = hub.building;
    move(a, 1, 0.5);
    move(a, 2, 8);
    hub.flush();
    const before = hub.version;
    a.client.preview(old);
    a.client.preview(null);
    a.store.getState().loadBuilding(old);
    hub.flush();
    expect(hub.version).toBe(before + 1);
    // Loading tidies interior walls into pieces from joint to joint (geometry/wallGraph.ts).
    const tidied = {
      ...old,
      storeys: old.storeys.map((s) => {
        const t = normalizeWalls({ walls: s.interiorWalls, openings: s.openings });
        return { ...s, interiorWalls: t.walls, openings: t.openings };
      }),
    };
    expect(sameJson(hub.building, tidied)).toBe(true);
    a.store.getState().undo();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(0.5);
    expect(opening(hub.building, 2).offset).toBe(8);
    expectConverged(a);
  });

  it("keeps edits made offline and sends each exactly once when back", () => {
    const a = openTab("a");
    const b = openTab("b");
    hub.flush();
    a.socket.drop();
    expect(a.client.status).toBe("offline");
    move(a, 1, 0.5);
    a.store.getState().setWallThickness(0.36);
    move(b, 2, 8);
    hub.flush();
    expect(a.client.unconfirmed).toBe(2);
    a.socket.restore();
    hub.flush();
    expect(opening(hub.building, 1).offset).toBe(0.5);
    expect(hub.building.wallThickness).toBe(0.36);
    expect(opening(hub.building, 2).offset).toBe(8);
    expect(hub.version).toBe(4);
    expectConverged(a, b);
  });

  it("does not send a batch twice when the connection broke after the server applied it", () => {
    const a = openTab("a");
    hub.flush();
    move(a, 1, 0.5);
    // The batch reaches the server and is written, then the line drops before anything
    // comes back.
    const socket = a.socket;
    hub.step();
    hub.step();
    expect(hub.version).toBe(2);
    socket.drop();
    socket.restore();
    hub.flush();
    expect(hub.version).toBe(2);
    expectConverged(a);
  });
});
