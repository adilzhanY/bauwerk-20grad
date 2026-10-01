import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { createEditorStore } from "@/store/building";
import type * as Projects from "./projects";
import type { ProjectRef } from "./projects";

const saved: { ref: ProjectRef; slot: string }[] = [];
let stored: { slot: string; width: number; height: number; updatedAt?: string }[] = [];
/** Changes the URLs handed out, as a replaced picture gets a new one. */
let urlTag = "";

vi.mock("./projects", async (original) => {
  const real = await original<typeof Projects>();
  return {
    ...real,
    savePhoto: (ref: ProjectRef, slot: string) => {
      saved.push({ ref, slot });
      return Promise.resolve();
    },
    photoSlots: () => Promise.resolve(stored),
    photoUrl: (_ref: ProjectRef, slot: string) => Promise.resolve(`blob:stored-${slot}${urlTag}`),
    shrinkImage: () => Promise.resolve({ blob: new Blob(["small"]), width: 48, height: 36 }),
  };
});

const { startPhotoSync } = await import("./photoSync");
const { FILES_EVENT } = await import("./files");

beforeEach(() => {
  saved.length = 0;
  stored = [];
  urlTag = "";
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(new Blob(["jpeg"]))));
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
});
