import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { createEditorStore, wallPhotoSlot } from "@/store/building";
import type * as Projects from "./projects";
import type { ProjectRef } from "./projects";

/**
 * A JPEG answer as fetch gives it. A string body with its type, not the test environment's
 * Blob: Node 22's Response cannot read that Blob (it has no stream()), Node 24 can.
 */
const jpegResponse = () => new Response("jpeg", { headers: { "content-type": "image/jpeg" } });

const saved: { ref: ProjectRef; slot: string }[] = [];
const removed: string[] = [];
let stored: { slot: string; width: number; height: number; updatedAt?: string }[] = [];
/** Changes the URLs handed out, as a replaced picture gets a new one. */
let urlTag = "";
/** How many of the next saves the server refuses, and with which status (none: offline). */
let refuse = 0;
let refuseStatus: number | undefined;

vi.mock("./projects", async (original) => {
  const real = await original<typeof Projects>();
  return {
    ...real,
    savePhoto: (ref: ProjectRef, slot: string) => {
      if (refuse > 0) {
        refuse -= 1;
        return Promise.reject(Object.assign(new Error("refused"), { status: refuseStatus }));
      }
      saved.push({ ref, slot });
      return Promise.resolve();
    },
    photoSlots: () => Promise.resolve(stored),
    removePhoto: (_ref: ProjectRef, slot: string) => {
      removed.push(slot);
      return Promise.resolve();
    },
    photoUrl: (_ref: ProjectRef, slot: string) => Promise.resolve(`blob:stored-${slot}${urlTag}`),
    shrinkImage: () => Promise.resolve({ blob: new Blob(["small"]), width: 48, height: 36 }),
  };
});

const { PHOTO_RETRY_MS, startPhotoSync } = await import("./photoSync");
const { FILES_EVENT } = await import("./files");

beforeEach(() => {
  saved.length = 0;
  removed.length = 0;
  stored = [];
  urlTag = "";
  refuse = 0;
  refuseStatus = undefined;
  vi.stubGlobal("fetch", () => Promise.resolve(jpegResponse()));
  URL.revokeObjectURL = () => undefined;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A building that is a saved project in this browser. */
const savedProject = (localId: string) => ({
  ...exampleHouse("en"),
  project: { client: "WEG", localId },
});

describe("startPhotoSync", () => {
  it("saves a photo put on a wall into the open project, with a card picture", async () => {
    const store = createEditorStore();
    store.getState().loadBuilding(savedProject("p1"));
    startPhotoSync(store);
    store.getState().setFacadePhoto(2, { url: "blob:new", width: 800, height: 600 });
    await settle();
    await settle();
    expect(saved.map((s) => s.slot)).toEqual(["2", "thumbnail"]);
    expect(saved[0]?.ref).toEqual({ kind: "local", id: "p1" });
  });

  it("tries a refused photo again after a pause", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const store = createEditorStore();
      store.getState().loadBuilding(savedProject("p1"));
      const stop = startPhotoSync(store);
      refuse = 1;
      store.getState().setFacadePhoto(2, { url: "blob:new", width: 800, height: 600 });
      await vi.advanceTimersByTimeAsync(0);
      expect(saved).toEqual([]);
      await vi.advanceTimersByTimeAsync(PHOTO_RETRY_MS);
      expect(saved.map((s) => s.slot)).toEqual(["2", "thumbnail"]);
      stop();
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("tries again after a server error or an expired sign in, never after a refusal for good", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      for (const [status, again] of [
        [503, true],
        [401, true],
        [403, false],
        [413, false],
        [400, false],
      ] as const) {
        saved.length = 0;
        const store = createEditorStore();
        store.getState().loadBuilding(savedProject("p1"));
        const stop = startPhotoSync(store);
        refuse = 1;
        refuseStatus = status;
        store.getState().setFacadePhoto(2, { url: `blob:${status}`, width: 800, height: 600 });
        await vi.advanceTimersByTimeAsync(PHOTO_RETRY_MS);
        expect(
          saved.map((s) => s.slot),
          String(status),
        ).toEqual(again ? ["2", "thumbnail"] : []);
        stop();
      }
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("brings a project's photos and floor plans back and does not save them again", async () => {
    stored = [
      { slot: "1", width: 640, height: 480 },
      { slot: "plan-s0", width: 900, height: 700 },
      { slot: "thumbnail", width: 48, height: 36 },
    ];
    const store = createEditorStore();
    startPhotoSync(store);
    store.getState().loadBuilding(savedProject("p2"));
    await vi.waitFor(() => {
      expect(store.getState().facadePhotos[1]?.url).toBe("blob:stored-1");
      expect(store.getState().floorPlanImages.s0?.url).toBe("blob:stored-plan-s0");
    });
    await settle();
    expect(store.getState().facadePhotos).not.toHaveProperty("thumbnail");
    expect(saved).toEqual([]);
  });

  it("keeps the pictures of unsaved work in the tab, and uploads them all with the first Save", async () => {
    const store = createEditorStore();
    store.getState().loadBuilding({ ...exampleHouse("en"), project: { client: "WEG" } });
    startPhotoSync(store);
    store.getState().setFacadePhoto(0, { url: "blob:wall", width: 10, height: 10 });
    store.getState().setFloorPlanImage("s0", { url: "blob:plan", width: 10, height: 10 });
    await settle();
    expect(saved).toEqual([]);

    store.getState().setProjectInfo({ localId: "p3" });
    await settle();
    await settle();
    expect(saved.map((s) => s.slot).sort()).toEqual(["0", "plan-s0", "thumbnail"]);
    expect(saved.every((s) => s.ref.kind === "local" && s.ref.id === "p3")).toBe(true);
  });

  it("follows pictures another tab or person replaced or removed when the files change", async () => {
    stored = [
      { slot: "1", width: 640, height: 480, updatedAt: "t1" },
      { slot: "plan-s0", width: 900, height: 700, updatedAt: "t1" },
    ];
    const store = createEditorStore();
    const stop = startPhotoSync(store);
    store.getState().loadBuilding(savedProject("p4"));
    await vi.waitFor(() => {
      expect(store.getState().facadePhotos[1]?.url).toBe("blob:stored-1");
    });
    // A picture put on here that is not uploaded yet must survive the reload.
    store.getState().setFacadePhoto(3, { url: "blob:mine", width: 10, height: 10 });

    // Someone replaced wall 2's photo and removed the floor plan.
    stored = [{ slot: "1", width: 640, height: 480, updatedAt: "t2" }];
    urlTag = "-new";
    window.dispatchEvent(new Event(FILES_EVENT));
    await vi.waitFor(() => {
      expect(store.getState().facadePhotos[1]?.url).toBe("blob:stored-1-new");
    });
    expect(store.getState().floorPlanImages).not.toHaveProperty("s0");
    expect(store.getState().facadePhotos[3]?.url).toBe("blob:mine");
    stop();
  });

  it("keeps a photo in its slot through a footprint edit and its undo", async () => {
    stored = [{ slot: "2", width: 640, height: 480, updatedAt: "t1" }];
    const store = createEditorStore();
    const stop = startPhotoSync(store);
    store.getState().loadBuilding(savedProject("p5"));
    await vi.waitFor(() => {
      expect(store.getState().facadePhotos[2]?.url).toBe("blob:stored-2");
    });
    // A corner on wall 0 splits it: wall 2 becomes wall 3 and keeps its photo and slot.
    store.getState().insertFootprintVertex(0);
    expect(wallPhotoSlot(store.getState().building, 3)).toBe("2");
    store.getState().undo();
    expect(wallPhotoSlot(store.getState().building, 2)).toBe("2");
    expect(store.getState().facadePhotos[2]?.url).toBe("blob:stored-2");
    await settle();
    expect(saved).toEqual([]);
    expect(removed).toEqual([]);
    stop();
  });
});
