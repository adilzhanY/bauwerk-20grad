/**
 * Three tabs edit one building at random while the network delivers their messages in a
 * random order, drops connections and brings them back. Whatever happens, every tab must
 * end with the server's building, and since every tab only ever makes edits that are valid
 * on its own screen, the server's building must never break an invariant on the way.
 *
 * Each seed plays one session. CONVERGENCE_SEEDS sets how many (CI runs 1000).
 */
import { describe, expect, it } from "vitest";
import type { Building } from "@/geometry/types";
import { validateBuilding } from "@/geometry/export";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createEditorStore } from "@/store/building";
import { SyncClient } from "./client";
import { sameJson } from "./ops";
import { TestHub } from "./testHub";
import type { FakeSocket } from "./testHub";

const SEEDS = Number(process.env.CONVERGENCE_SEEDS ?? 300);
const EDITS = 40;

/** Small, fast, seeded. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Store = ReturnType<typeof createEditorStore>;

interface Tab {
  store: Store;
  client: SyncClient;
  socket: FakeSocket;
}

/** A change a user could make: what it does to a copy, and the store action that does it. */
interface Edit {
  preview: (draft: Building) => void;
  run: (store: Store) => void;
}

function randomEdit(building: Building, random: () => number): Edit | "undo" | "redo" {
  const pick = <T>(items: readonly T[]): T | undefined =>
    items[Math.floor(random() * items.length)];
  const roll = random();
  if (roll < 0.08) return "undo";
  if (roll < 0.12) return "redo";
  const storey = pick(building.storeys);
  if (!storey) return "undo";
  const opening = pick(storey.openings);
  const round = (x: number) => Math.round(x * 10) / 10;
  if (roll < 0.5 && opening) {
    const offset = round(random() * 9);
    return {
      preview: (d) => {
        const o = d.storeys
          .find((s) => s.id === storey.id)
          ?.openings.find((x) => x.id === opening.id);
        if (o) o.offset = offset;
      },
      run: (s) => {
        s.getState().updateOpening(storey.id, opening.id, { offset });
      },
    };
  }
  if (roll < 0.62 && opening) {
    const width = round(0.6 + random() * 1.4);
    return {
      preview: (d) => {
        const o = d.storeys
          .find((s) => s.id === storey.id)
          ?.openings.find((x) => x.id === opening.id);
        if (o) o.width = width;
      },
      run: (s) => {
        s.getState().updateOpening(storey.id, opening.id, { width });
      },
    };
  }
  if (roll < 0.7 && opening) {
    return {
      preview: (d) => {
        const s = d.storeys.find((x) => x.id === storey.id);
        if (s) s.openings = s.openings.filter((x) => x.id !== opening.id);
      },
      run: (s) => {
        s.getState().removeOpening(storey.id, opening.id);
      },
    };
  }
  if (roll < 0.8) {
    const offset = round(random() * 8.5);
    const wallIndex = Math.floor(random() * building.footprint.length);
    const fresh = { kind: "window" as const, wallIndex, offset, width: 1, height: 1.2, sill: 0.9 };
    return {
      preview: (d) => {
        const s = d.storeys.find((x) => x.id === storey.id);
        s?.openings.push({ ...fresh, id: "preview", constructionId: d.windowConstructionId });
      },
      run: (s) => {
        s.getState().addOpening(storey.id, fresh);
      },
    };
  }
  if (roll < 0.87) {
    const height = round(2.6 + random() * 0.9);
    return {
      preview: (d) => {
        const s = d.storeys.find((x) => x.id === storey.id);
        if (s) s.height = height;
      },
      run: (s) => {
        s.getState().setStoreyHeight(storey.id, height);
      },
    };
  }
  if (roll < 0.94) {
    const name = `House ${Math.floor(random() * 100)}`;
    return {
      preview: (d) => {
        d.name = name;
      },
      run: (s) => {
        s.getState().renameBuilding(name);
      },
    };
  }
  const thickness = round(0.2 + random() * 0.3);
  return {
    preview: (d) => {
      d.wallThickness = thickness;
    },
    run: (s) => {
      s.getState().setWallThickness(thickness);
    },
  };
}

/** One tab makes one random edit, but only one that is valid on its own screen. */
function edit(tab: Tab, random: () => number) {
  const state = tab.store.getState();
  const choice = randomEdit(state.building, random);
  if (choice === "undo" || choice === "redo") {
    const target = choice === "undo" ? state.past.at(-1) : state.future.at(-1);
    if (target && validateBuilding(target) === null) state[choice]();
    return;
  }
  const draft = structuredClone(state.building);
  choice.preview(draft);
  if (validateBuilding(draft) === null) choice.run(tab.store);
}

function session(seed: number) {
  resetIds();
  const random = mulberry32(seed);
  const hub = new TestHub(exampleHouse("en"), random);
  const tabs: Tab[] = ["a", "b", "c"].map((name) => {
    const store = createEditorStore();
    const client = new SyncClient(store, {
      apiUrl: "/collab",
      projectId: "p",
      actor: name,
      color: "#123456",
      clientId: name,
      connect: hub.connect,
    });
    client.start();
    const socket = hub.sockets.at(-1);
    if (!socket) throw new Error("no socket");
    return { store, client, socket };
  });
  hub.flush();

  for (let i = 0; i < EDITS; i++) {
    const tab = tabs[Math.floor(random() * tabs.length)];
    if (!tab) continue;
    const roll = random();
    if (roll < 0.05) tab.socket.drop();
    else if (roll < 0.12 && !tab.socket.online) tab.socket.restore();
    else edit(tab, random);
    // Let a few messages through between edits, so edits race each other.
    const steps = Math.floor(random() * 6);
    for (let s = 0; s < steps; s++) {
      hub.step();
      const broken = validateBuilding(hub.building);
      if (broken) throw new Error(`seed ${seed}: server building broke ${broken.code}`);
    }
  }
  for (const tab of tabs) if (!tab.socket.online) tab.socket.restore();
  hub.flush();

  for (const tab of tabs) {
    const shown = tab.store.getState().building;
    if (tab.client.unconfirmed !== 0 || !sameJson(shown, hub.building)) {
      throw new Error(`seed ${seed}: tab ${tab.client.clientId} did not converge`);
    }
  }
  expect(validateBuilding(hub.building)).toBeNull();
  return hub.version;
}

describe("convergence", () => {
  it(`every tab ends with the server's building, over ${SEEDS} random sessions`, () => {
    let batches = 0;
    for (let seed = 1; seed <= SEEDS; seed++) batches += session(seed) - 1;
    // The sessions must actually edit, or the test proves nothing.
    expect(batches).toBeGreaterThan(SEEDS * 5);
    // About 5 s alone; the full suite runs every file at once on the same cores, which can
    // stretch it past the default 20 s. The seeds are fixed, so only the time varies.
  }, 60_000);
});
