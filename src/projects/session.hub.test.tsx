import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TestHub } from "@/sync/testHub";

/**
 * The app's own connection (useSync) to a server project, with the fake hub of sync/testHub.ts
 * in place of Socket.IO: what the session does to an open project, as the others would see it.
 */
const fake = vi.hoisted(() => ({ hub: null as TestHub | null, sent: [] as unknown[] }));

vi.mock("socket.io-client", () => ({
  io: () => {
    if (!fake.hub) throw new Error("no hub");
    const socket = fake.hub.connect();
    const emit = socket.emit.bind(socket);
    // Every batch of edits the tab sends to the server.
    socket.emit = (event, data, ack) => {
      if (event === "ops") fake.sent.push(data);
      emit(event, data, ack);
    };
    return socket;
  },
}));

let posts = 0;
let releasePost: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  fake.sent = [];
  posts = 0;
  window.history.replaceState(null, "", "/");
  vi.stubEnv("VITE_API_URL", "/collab");
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/projects") && init?.method === "POST") {
        posts += 1;
        // The server takes its time, so a second Save can come while it works.
        await new Promise<void>((resolve) => {
          releasePost = resolve;
        });
        const body = JSON.parse(String(init.body)) as { building: TestHub["building"] };
        if (fake.hub) fake.hub.building = body.building;
        return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
      }
      return new Response("[]", { status: 200 });
    }),
  );
});

afterEach(() => {
  fake.hub = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load() {
  const { useEditorStore } = await import("@/store/building");
  const { useAuth } = await import("@/auth/store");
  const { useSync } = await import("@/sync/useSync");
  const { TestHub } = await import("@/sync/testHub");
  const { exampleHouse } = await import("@/lib/examples");
  const session = await import("./session");
  const hub = new TestHub(exampleHouse("en"));
  fake.hub = hub;
  useAuth.setState({ status: "off", account: null });
  useEditorStore.setState({ language: "en" });
  function Connection() {
    useSync();
    return null;
  }
  render(<Connection />);
  const flush = () => {
    act(() => {
      hub.flush();
    });
  };
  return { hub, flush, useEditorStore, ...session };
}

/** Opens server project p1 in the app, as a project card does. */
async function openP1() {
  window.history.replaceState(null, "", "/?project=p1");
  const app = await load();
  app.flush();
  expect(app.useEditorStore.getState().projectId).toBe("p1");
  return app;
}

describe("a server project", () => {
  it("is not overwritten when an example is picked in it", async () => {
    const { hub, flush, useEditorStore } = await openP1();
    const { SettingsSection } = await import("@/components/editor/SettingsSection");
    render(<SettingsSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: "Load example" }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Large office tower" }));
      await Promise.resolve();
    });
    flush();
    expect(fake.sent).toEqual([]);
    expect(hub.version).toBe(1);
    // The example is a new project of its own, outside p1.
    expect(useEditorStore.getState().projectId).toBeNull();
    expect(useEditorStore.getState().building.name).not.toBe(hub.building.name);
  });

  it("keeps its names when this person switches language", async () => {
    const { hub, flush, useEditorStore } = await openP1();
    act(() => {
      useEditorStore.getState().setLanguage("de");
    });
    flush();
    expect(useEditorStore.getState().building.storeys[0]?.name).not.toBe(
      hub.building.storeys[0]?.name,
    );
    expect(fake.sent).toEqual([]);
    expect(hub.version).toBe(1);
    // An edit afterwards still goes out, and only that edit.
    act(() => {
      useEditorStore.getState().renameBuilding("Renamed");
    });
    flush();
    expect(hub.building.name).toBe("Renamed");
    expect(hub.building.storeys[0]?.name).toBe("Ground floor");
  });
});

describe("saving", () => {
  it("twice at once creates one project", async () => {
    const { saveProject } = await load();
    const first = saveProject();
    const second = saveProject();
    await act(async () => {
      await Promise.resolve();
      releasePost();
      expect(await first).toBe(true);
      expect(await second).toBe(true);
    });
    expect(posts).toBe(1);
  });

  it("keeps the edits made before the project has connected", async () => {
    const { hub, flush, useEditorStore, saveProject } = await load();
    const saved = saveProject();
    await act(async () => {
      await Promise.resolve();
      releasePost();
      expect(await saved).toBe(true);
    });
    // Saved and not joined yet: the user goes on drawing.
    act(() => {
      useEditorStore.getState().renameBuilding("Drawn on");
    });
    flush();
    expect(useEditorStore.getState().projectId).toBe("p1");
    expect(useEditorStore.getState().building.name).toBe("Drawn on");
    expect(hub.building.name).toBe("Drawn on");
  });
});
