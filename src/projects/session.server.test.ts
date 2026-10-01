import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { rememberOpenProject, saveProjectCopy } from "@/lib/storage";

/**
 * With a server, as in the app since accounts: the modules read VITE_API_URL when they load,
 * so each test loads them fresh.
 */
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_API_URL", "/collab");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function load() {
  const { useRouter } = await import("@/app/router");
  const { useEditorStore } = await import("@/store/building");
  const session = await import("./session");
  return { useRouter, useEditorStore, ...session };
}

describe("with a server", () => {
  it("a copy of BOo this browser kept from before is not saved: leaving it asks", async () => {
    // The browser still holds BOo as a browser project, and reopens it at start.
    const localId = "kept-before-accounts";
    saveProjectCopy({ ...exampleHouse("en"), project: { gid: "DEBE02YY40000BOo", localId } });
    rememberOpenProject(localId);
    const { useRouter, useEditorStore, isUnsaved, startLeaveGuard, useLeave } = await load();
    expect(useEditorStore.getState().building.project?.localId).toBe(localId);
    expect(isUnsaved()).toBe(true);

    // A photo applied to it, then Projects in the header.
    const stop = startLeaveGuard();
    useRouter.setState({ route: { page: "editor" } });
    const storeyId = useEditorStore.getState().building.storeys[0]?.id ?? "";
    useEditorStore.getState().addInteriorWall(storeyId, { a: { x: 1, y: 0 }, b: { x: 1, y: 3 } });
    useRouter.getState().navigate({ page: "projects" });
    await expect.poll(() => useLeave.getState().answer).not.toBeNull();
    await useLeave.getState().answer?.("cancel");
    expect(useRouter.getState().route.page).toBe("editor");
    stop();
  });

  it("a key event without a key (the browser's autofill) does not break Ctrl+S", async () => {
    const { startLeaveGuard } = await load();
    const stop = startLeaveGuard();
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener("error", onError);
    window.dispatchEvent(new Event("keydown"));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    stop();
  });
});
