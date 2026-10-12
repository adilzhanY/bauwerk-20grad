import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/store/building";
import { useSurvey } from "@/lod2/state/survey";
import type { BuildingSurvey } from "@/lod2/state/survey";
import { signOut, useAuth } from "./store";
import { mergeUserData, startUserData, syncBookmark } from "./userData";

const survey = (storeys: number): BuildingSurvey => ({
  walls: {},
  facts: { ageClass: "bis1918", ageClassConfirmed: true, storeys },
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function server(data: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace("/collab", "");
      if (method === "GET")
        return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
      calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubEnv("VITE_API_URL", "/collab");
  localStorage.clear();
  localStorage.setItem("bauwerk.session", "t.o.k");
  useAuth.setState({
    status: "signedIn",
    account: { id: "u", username: "ada_l", firstName: "Ada", lastName: "Lovelace", color: "#000" },
  });
  useSurvey.setState({ buildings: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a user's data between browser and server", () => {
  it("takes the account's data on sign in and sends up what only this browser had", async () => {
    localStorage.setItem("bauwerk.bookmarks", JSON.stringify(["LOCAL1"]));
    localStorage.setItem("bauwerk.notes.LOCAL1", "only here");
    useSurvey.setState({ buildings: { LOCAL1: survey(3) } });
    const calls = server({
      settings: { language: "de", theme: null, projectsView: "map" },
      bookmarks: ["SERVER1"],
      buildings: [{ gid: "SERVER1", note: "vom Konto", survey: survey(5) }],
    });
    await mergeUserData();
    await vi.advanceTimersByTimeAsync(700);

    expect(useEditorStore.getState().language).toBe("de");
    expect(localStorage.getItem("bauwerk.projectsView")).toBe("map");
    expect(JSON.parse(localStorage.getItem("bauwerk.bookmarks") ?? "[]")).toEqual([
      "SERVER1",
      "LOCAL1",
    ]);
    expect(localStorage.getItem("bauwerk.notes.SERVER1")).toBe("vom Konto");
    expect(useSurvey.getState().buildings.SERVER1?.facts.storeys).toBe(5);
    expect(useSurvey.getState().buildings.LOCAL1?.facts.storeys).toBe(3);

    expect(calls).toContainEqual({
      method: "PUT",
      path: "/me/settings",
      body: { theme: useEditorStore.getState().theme },
    });
    expect(calls).toContainEqual({ method: "PUT", path: "/me/bookmarks/LOCAL1", body: undefined });
    expect(calls).toContainEqual({
      method: "PUT",
      path: "/me/buildings/LOCAL1",
      body: { note: "only here" },
    });
    expect(calls).toContainEqual({
      method: "PUT",
      path: "/me/buildings/LOCAL1",
      body: { survey: survey(3) },
    });
    expect(calls.some((c) => c.path.includes("SERVER1"))).toBe(false);
  });

  it("sends a change while signed in, and nothing signed out", async () => {
    const calls = server({ settings: {}, bookmarks: [], buildings: [] });
    syncBookmark("DEBE02YY40000BOo", true);
    syncBookmark("DEBE02YY40000BOo", false);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /me/bookmarks/DEBE02YY40000BOo",
      "DELETE /me/bookmarks/DEBE02YY40000BOo",
    ]);
    useAuth.setState({ status: "signedOut", account: null });
    syncBookmark("DEBE02YY40000BOo", true);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(2);
  });

  it("ignores a /me reply that is not the expected shape", async () => {
    server({ settings: {}, bookmarks: "not a list", buildings: [] });
    await mergeUserData();
    expect(localStorage.getItem("bauwerk.bookmarks")).toBeNull();
  });

  // Last: it starts following the sign in for the rest of the file.
  it("forgets the bookmarks, notes and surveys on sign out, so the next account does not get them", () => {
    startUserData();
    localStorage.setItem("bauwerk.bookmarks", JSON.stringify(["A"]));
    localStorage.setItem("bauwerk.notes.A", "mine");
    localStorage.setItem("lod2.survey.v1", JSON.stringify({ A: survey(3) }));
    useSurvey.setState({ buildings: { A: survey(3) } });
    signOut();
    expect(localStorage.getItem("bauwerk.bookmarks")).toBeNull();
    expect(localStorage.getItem("bauwerk.notes.A")).toBeNull();
    expect(localStorage.getItem("lod2.survey.v1")).toBeNull();
    expect(useSurvey.getState().buildings).toEqual({});
  });
});
