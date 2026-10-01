import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * The whole app with a server and an account, as in `npm run dev`: a building opened from its
 * building page with a facade photo applied, then Projects. The modules read VITE_API_URL when
 * they load, so they are loaded fresh.
 */
beforeEach(() => {
  localStorage.clear();
  window.innerWidth = 1600;
  vi.stubEnv("VITE_API_URL", "/collab");
  vi.resetModules();
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/auth/mode")) return Promise.resolve(json({ accounts: true }));
      if (url.endsWith("/auth/me"))
        return Promise.resolve(
          json({
            id: "6f1c2b1e-0000-4000-8000-000000000009",
            username: "kowix",
            firstName: "K",
            lastName: "W",
          }),
        );
      if (url.endsWith("/projects")) return Promise.resolve(json([]));
      return Promise.resolve(json({}));
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("leaving a building with a photo applied", () => {
  // Presence handed the dialog's answer, a function, to useState, which called it as an
  // updater while rendering: the question answered itself and the app left.
  it("asks whether to save it", async () => {
    localStorage.setItem("bauwerk.session", "t.o.k");
    const { App } = await import("@/App");
    const { useRouter } = await import("@/app/router");
    const { useEditorStore } = await import("@/store/building");
    const { startAuth, useAuth } = await import("@/auth/store");
    const { openForWork, startLeaveGuard, isUnsaved } = await import("./session");
    const { withProject } = await import("./projects");
    const { analyzePart } = await import("@/lod2/analysis");
    const { loadFixture, surveyFromFixture } = await import("@/lod2/testFixtures");
    startLeaveGuard();
    await startAuth();
    expect(useAuth.getState().status).toBe("signedIn");

    const gid = "DEBE02YY40000BOo";
    const { detail, survey, neighbours } = loadFixture(gid);
    const result = analyzePart(detail, survey.partGid, surveyFromFixture(survey), neighbours, "en");
    if (!result.ok) throw new Error(result.reason);
    const withFacts = (b: typeof result.analysis.building) => withProject(b, { gid });
    useRouter.setState({ route: { page: "building", gid } });
    expect(await openForWork(withFacts(result.analysis.building), withFacts)).toBe(true);
    useRouter.getState().navigate({ page: "editor" });
    useEditorStore.getState().setFacadePhoto(0, { url: "blob:wall", width: 10, height: 10 });
    expect(isUnsaved()).toBe(true);

    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Projects/ })[0]!);
      await Promise.resolve();
    });
    // The dialog stays until it is answered; the work stays open meanwhile.
    expect(await screen.findByRole("dialog", { name: "Save this project?" })).toBeTruthy();
    expect(useRouter.getState().route.page).toBe("editor");
  });
});
