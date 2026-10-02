import { normalizeWalls } from "@/geometry/wallGraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRouter } from "@/app/router";
import { useAuth } from "@/auth/store";
import type { Building } from "@/geometry/types";
import { exampleHouse } from "@/lib/examples";
import { listProjectCopies } from "@/lib/storage";
import { useEditorStore } from "@/store/building";
import type { ProjectCard } from "./projects";
import {
  isUnsaved,
  openBuilding,
  openForWork,
  openProjectCard,
  saveProject,
  startAutoSave,
  startLeaveGuard,
  useLeave,
} from "./session";

/** A building's ground floor walls as the editor keeps them: from joint to joint. */
const pieces = (b: Building) =>
  normalizeWalls({
    walls: b.storeys[0]?.interiorWalls ?? [],
    openings: b.storeys[0]?.openings ?? [],
  }).walls;

/** BOo as the building page hands it over: with its Gebäude-ID in the project facts. */
const boo = (): Building => ({ ...exampleHouse("en"), project: { gid: "DEBE02YY40000BOo" } });

let stopGuard: () => void = () => undefined;

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ language: "en", projectId: null });
  openBuilding(exampleHouse("en"));
  useRouter.setState({ route: { page: "projects" } });
  stopGuard = startLeaveGuard();
});

afterEach(() => {
  stopGuard();
  useLeave.setState({ answer: null });
});

/** Answers the "Save this project?" dialog once it is asked. */
async function answer(choice: "save" | "discard" | "cancel") {
  await expect.poll(() => useLeave.getState().answer).not.toBeNull();
  await useLeave.getState().answer?.(choice);
}

describe("a new project", () => {
  it("of the same house starts clean: no floor plan, no photos, no undo back", async () => {
    // A first project of BOo, with a floor plan applied and a photo, saved.
    await openForWork(boo(), undefined, { fresh: true });
    const store = useEditorStore.getState;
    const storeyId = store().building.storeys[0]?.id ?? "";
    store().addInteriorWall(storeyId, { a: { x: 1, y: 0 }, b: { x: 1, y: 3 } });
    store().setFacadePhoto(0, { url: "blob:wall", width: 10, height: 10 });
    store().setFloorPlanImage(storeyId, { url: "blob:plan", width: 10, height: 10 });
    expect(await saveProject()).toBe(true);

    // New project of the same house.
    expect(await openForWork(boo(), undefined, { fresh: true })).toBe(true);
    expect(store().building.storeys[0]?.interiorWalls).toEqual(pieces(boo()));
    expect(store().facadePhotos).toEqual({});
    expect(store().floorPlanImages).toEqual({});
    expect(store().past).toEqual([]);
    expect(store().building.project?.localId).toBeUndefined();
    expect(isUnsaved()).toBe(true);
  });

  it("is saved only by Save, under its own id", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    expect(listProjectCopies()).toEqual([]);
    await saveProject();
    await saveProject();
    expect(isUnsaved()).toBe(false);
    expect(listProjectCopies()).toHaveLength(1);
  });

  it("goes on with this house's open project when no new one was asked for", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    const storeyId = useEditorStore.getState().building.storeys[0]?.id ?? "";
    useEditorStore.getState().addInteriorWall(storeyId, { a: { x: 1, y: 0 }, b: { x: 1, y: 3 } });
    expect(await openForWork(boo())).toBe(true);
    const added = { a: { x: 1, y: 0 }, b: { x: 1, y: 3 } };
    expect(useEditorStore.getState().building.storeys[0]?.interiorWalls).toHaveLength(
      pieces({
        ...boo(),
        storeys: boo().storeys.map((s, i) =>
          i === 0 ? { ...s, interiorWalls: [...s.interiorWalls, added] } : s,
        ),
      }).length,
    );
  });
});

describe("unsaved work", () => {
  it("a building without a project counts only once it was changed", () => {
    expect(isUnsaved()).toBe(false);
    useEditorStore.getState().setWallThickness(0.4);
    expect(isUnsaved()).toBe(true);
  });

  it("leaving it through the app asks; Cancel stays", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    useRouter.setState({ route: { page: "editor" } });
    useRouter.getState().navigate({ page: "projects" });
    await answer("cancel");
    expect(useRouter.getState().route.page).toBe("editor");
    expect(useEditorStore.getState().building.project?.gid).toBe("DEBE02YY40000BOo");
  });

  it("Don't save throws the work away and leaves", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    useRouter.setState({ route: { page: "editor" } });
    useRouter.getState().navigate({ page: "projects" });
    await answer("discard");
    await expect.poll(() => useRouter.getState().route.page).toBe("projects");
    expect(useEditorStore.getState().building.project).toBeUndefined();
    expect(listProjectCopies()).toEqual([]);
  });

  it("Save keeps the project and leaves; a saved project leaves without asking", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    useRouter.setState({ route: { page: "editor" } });
    useRouter.getState().navigate({ page: "projects" });
    await answer("save");
    await expect.poll(() => useRouter.getState().route.page).toBe("projects");
    expect(listProjectCopies()).toHaveLength(1);

    useRouter.setState({ route: { page: "editor" } });
    useRouter.getState().navigate({ page: "map" });
    expect(useRouter.getState().route.page).toBe("map");
    expect(useLeave.getState().answer).toBeNull();
  });

  it("opening a project card asks first; Cancel keeps the work", async () => {
    // A saved browser project, then new unsaved work.
    await openForWork(boo(), undefined, { fresh: true });
    await saveProject();
    const localId = useEditorStore.getState().building.project?.localId ?? "";
    await openForWork(exampleHouse("en"), undefined, { fresh: true });
    useEditorStore.getState().setWallThickness(0.4);
    const card = { ref: { kind: "local", id: localId } } as ProjectCard;

    const opening = openProjectCard(card);
    await answer("cancel");
    expect(await opening).toBe("stayed");
    expect(useEditorStore.getState().building.wallThickness).toBe(0.4);

    const again = openProjectCard(card);
    await answer("discard");
    expect(await again).toBe("opened");
    expect(useEditorStore.getState().building.project?.localId).toBe(localId);
  });

  it("a project card that cannot be opened says so", async () => {
    const card = { ref: { kind: "local", id: "gone" } } as ProjectCard;
    expect(await openProjectCard(card)).toBe("failed");
  });

  it("moving between the steps of the project does not ask", async () => {
    await openForWork(boo(), undefined, { fresh: true });
    useRouter.setState({ route: { page: "editor" } });
    useRouter.getState().navigate({ page: "variants" });
    useRouter.getState().navigate({ page: "building", gid: "DEBE02YY40000BOo" });
    expect(useRouter.getState().route).toEqual({ page: "building", gid: "DEBE02YY40000BOo" });
    expect(useLeave.getState().answer).toBeNull();
  });
});

describe("saving by itself", () => {
  let stopAutoSave: () => void = () => undefined;
  beforeEach(() => {
    useAuth.setState({ status: "off", account: null });
  });
  afterEach(() => {
    stopAutoSave();
  });

  it("saves a chosen building as soon as it opens", async () => {
    stopAutoSave = startAutoSave();
    await openForWork(boo(), undefined, { fresh: true });
    await expect.poll(() => listProjectCopies()).toHaveLength(1);
    expect(isUnsaved()).toBe(false);
  });

  it("saves the building made in the editor only at its first change, even a window moved", async () => {
    stopAutoSave = startAutoSave();
    await Promise.resolve();
    expect(listProjectCopies()).toEqual([]);
    const storey = useEditorStore.getState().building.storeys[0];
    const window = storey?.openings[0];
    if (!storey || !window) throw new Error("the example house has windows");
    useEditorStore.getState().updateOpening(storey.id, window.id, { offset: window.offset + 0.1 });
    await expect.poll(() => listProjectCopies()).toHaveLength(1);
    expect(isUnsaved()).toBe(false);
    // Saved once: further changes go into the same project.
    useEditorStore.getState().setWallThickness(0.4);
    await Promise.resolve();
    expect(listProjectCopies()).toHaveLength(1);
  });

  it("waits for the sign-in state before it saves", async () => {
    useAuth.setState({ status: "loading", account: null });
    stopAutoSave = startAutoSave();
    await openForWork(boo(), undefined, { fresh: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listProjectCopies()).toEqual([]);
    useAuth.setState({ status: "signedOut", account: null });
    await expect.poll(() => listProjectCopies()).toHaveLength(1);
  });
});
