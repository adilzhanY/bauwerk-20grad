import { useEffect, useMemo, useState } from "react";
import type { ChangeSummary } from "./summary";
import { loginPath, useRouter } from "@/app/router";
import { fullName, useAuth } from "@/auth/store";
import { accessToken, authHeaders } from "@/auth/api";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import type { Building } from "@/geometry/types";
import { useEditorStore } from "@/store/building";
import type { HistoryPreview } from "@/store/building";
import { SyncClient, randomActor, syncConfigFromEnv } from "./client";
import type { Overwrite, Rejection, SyncStatus } from "./client";

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** The id of the building inside; older servers leave it out. */
  buildingId?: string;
  /** What the Projects page shows on the card; older servers leave it out. */
  summary?: CardSummary;
  owner?: { id: string; firstName: string; lastName: string };
  /** Who has it open right now (oneself left out), and when oneself last had it open. */
  here?: HereNow[];
  lastSeenAt?: string | null;
}

export interface HereNow {
  userId: string;
  firstName: string;
  lastName: string;
  state: "here" | "away";
}

const ACTOR_KEY = "bauwerk.actor";

/**
 * Who this tab is. Kept per tab (sessionStorage), so two tabs side by side are two people,
 * and a reload keeps the name.
 */
export function actorIdentity(): { actor: string; color: string } {
  try {
    const saved = sessionStorage.getItem(ACTOR_KEY);
    if (saved) return JSON.parse(saved) as { actor: string; color: string };
    const fresh = randomActor();
    sessionStorage.setItem(ACTOR_KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return randomActor();
  }
}

export function projectIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("project");
}

export function setProjectInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("project", id);
  else url.searchParams.delete("project");
  window.history.replaceState(null, "", url);
}

export const syncEnabled = syncConfigFromEnv() !== null;

/** A tab hidden this long counts as away. */
const AWAY_AFTER_MS = 3 * 60_000;
const PROJECT_PAGES = new Set(["building", "editor", "variants", "report"]);

/**
 * Tells the project where this person is (TODO Part 21, CC.1): the page of the project and
 * the active storey, and away once the tab has been hidden for three minutes.
 */
function reportPlace(client: SyncClient): () => void {
  let away = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    const page = useRouter.getState().route.page;
    client.report({
      state: away ? "away" : "here",
      page: PROJECT_PAGES.has(page) ? page : null,
      storeyId: useEditorStore.getState().activeStoreyId,
    });
  };
  const onVisibility = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (document.visibilityState === "hidden") {
      timer = setTimeout(() => {
        away = true;
        send();
      }, AWAY_AFTER_MS);
    } else {
      away = false;
      send();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  const offRoute = useRouter.subscribe(send);
  const offStore = useEditorStore.subscribe((state, prev) => {
    if (state.activeStoreyId !== prev.activeStoreyId) send();
  });
  send();
  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    offRoute();
    offStore();
  };
}

/** Takes the share link's token out of the address once it has been used. */
function dropLinkFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("link")) return;
  url.searchParams.delete("link");
  window.history.replaceState(null, "", url);
}

/** The client of the project open in this tab, for the history panel. */
let active: SyncClient | null = null;

export interface VersionEntry {
  version: number;
  actor: string;
  createdAt: string;
  kind: "create" | "ops";
  changes: number;
  /** The account behind it, and what it did; older servers leave them out. */
  actorId?: string | null;
  summary?: ChangeSummary;
}

function projectUrl(path = ""): string | null {
  const cfg = syncConfigFromEnv();
  const id = useEditorStore.getState().projectId;
  return cfg && id ? `${cfg.apiUrl}/projects/${id}${path}` : null;
}

/** Every version of the open project, newest first. Empty when none is open. */
export async function fetchVersions(): Promise<VersionEntry[]> {
  const url = projectUrl("/versions");
  if (!url) return [];
  const res = await fetch(url, { headers: await authHeaders() });
  return res.ok ? ((await res.json()) as VersionEntry[]) : [];
}

/** The open project's building as it was at `version`, or null when it cannot be rebuilt. */
export async function fetchVersion(version: number): Promise<Building | null> {
  const url = projectUrl(`/versions/${version}`);
  if (!url) return null;
  const res = await fetch(url, { headers: await authHeaders() });
  return res.ok ? ((await res.json()) as { building: Building }).building : null;
}

/** The old version on screen, kept for "restore". */
let previewed: Building | null = null;

/** Shows an old version read only. */
export function showVersion(building: Building, meta: HistoryPreview): void {
  if (!active) return;
  previewed = building;
  active.preview(building);
  useEditorStore.getState().setHistoryPreview(meta);
}

/** Back to the live building. */
export function endVersionPreview(): void {
  previewed = null;
  active?.preview(null);
  useEditorStore.getState().setHistoryPreview(null);
}

/** Makes the version on screen the newest one: one ordinary edit, which undo takes back. */
export function restoreVersion(): void {
  const building = previewed;
  endVersionPreview();
  if (building) useEditorStore.getState().loadBuilding(building);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const cfg = syncConfigFromEnv();
  if (!cfg) return [];
  const res = await fetch(`${cfg.apiUrl}/projects`, { headers: await authHeaders() });
  return res.ok ? ((await res.json()) as ProjectSummary[]) : [];
}

/**
 * The project this tab just created, with the building it sent, until its connection has
 * joined: edits made in between are sent as the first batch (SyncConfig.base).
 */
let created: { id: string; building: Building } | null = null;

/** Why the last createProject failed: the sign in ran out, or the server could not save it. */
let createFailure: "signIn" | "server" | null = null;
export const lastCreateFailure = () => createFailure;

/** Waits before each new try: a deploy restarts the server for a few seconds. */
const RETRY_MS = [1500, 3000];

export async function createProject(): Promise<string | null> {
  createFailure = null;
  const cfg = syncConfigFromEnv();
  if (!cfg) return null;
  const { actor } = actorIdentity();
  const building = useEditorStore.getState().building;
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch(`${cfg.apiUrl}/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-actor": actor, ...(await authHeaders()) },
        body: JSON.stringify({ building }),
      });
      if (res.ok) {
        const project = (await res.json()) as { id: string };
        created = { id: project.id, building };
        return project.id;
      }
      status = res.status;
    } catch {
      // No answer at all: the server is restarting or the connection dropped. Tried again.
    }
    if (status === 401) {
      createFailure = "signIn";
      return null;
    }
    // Only "not reachable" is worth another try; the server refusing the building is not.
    const transient = status === 0 || status === 502 || status === 503 || status === 504;
    const wait = RETRY_MS[attempt];
    if (!transient || wait === undefined) {
      createFailure = "server";
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Connects the store to the project named in the URL. Without VITE_API_URL this
 * hook does nothing and the app stays a local, localStorage-backed editor.
 */
/** The open project's connection, as the pages show it. */
export interface Sync {
  status: SyncStatus | "local";
  actor: string;
  color: string;
  rejection: Rejection | null;
  dismissRejection: () => void;
  /** Someone else's change just landed on one of this person's (TODO Part 21, CH.2). */
  overwrite: Overwrite | null;
  keepMine: () => void;
  dismissOverwrite: () => void;
}

/** No connection: a page shown without a project on the server. */
export const LOCAL_SYNC: Sync = {
  status: "local",
  actor: "",
  color: "",
  rejection: null,
  dismissRejection: () => undefined,
  overwrite: null,
  keepMine: () => undefined,
  dismissOverwrite: () => undefined,
};

/**
 * Keeps the project named in the address connected. Run once, by App, so a project stays
 * live on all its pages, not only in the editor: opening a project from the Projects page
 * waits for it to join.
 */
export function useSync(): Sync {
  const [status, setStatus] = useState<SyncStatus | "local">(syncEnabled ? "connecting" : "local");
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [overwrite, setOverwrite] = useState<Overwrite | null>(null);
  const [tabIdentity] = useState(actorIdentity);
  const [urlProject, setUrlProject] = useState(projectIdFromUrl);
  const authStatus = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  // Signed in, people are their account: the name and colour everyone else sees too.
  const identity = useMemo(
    () => (account ? { actor: fullName(account), color: account.color } : tabIdentity),
    [account, tabIdentity],
  );

  useEffect(() => {
    const onPop = () => {
      setUrlProject(projectIdFromUrl());
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("bauwerk:project", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("bauwerk:project", onPop);
    };
  }, []);

  useEffect(() => {
    const cfg = syncConfigFromEnv();
    if (!cfg || !urlProject) return;
    // Until the server has said whether there are accounts, wait.
    if (authStatus === "loading") return;
    if (authStatus === "signedOut") {
      // A shared link needs an account: sign in, then come back to it.
      window.location.assign(loginPath());
      return;
    }
    // A share link carries its token as ?link=…; once the person is a member it is not needed.
    const link = new URLSearchParams(window.location.search).get("link") ?? undefined;
    const base = created?.id === urlProject ? created.building : undefined;
    const client = new SyncClient(useEditorStore, {
      ...cfg,
      projectId: urlProject,
      ...(base ? { base } : {}),
      ...identity,
      ...(link ? { link } : {}),
      ...(authStatus !== "off" ? { token: accessToken } : {}),
    });
    const offStatus = client.onStatus((next) => {
      setStatus(next);
      if (next === "online" && created?.id === urlProject) created = null;
      if (next === "online" && link) dropLinkFromUrl();
    });
    const offReject = client.onReject(setRejection);
    const offOverwrite = client.onOverwrite(setOverwrite);
    active = client;
    client.start();
    const stopPlace = reportPlace(client);
    return () => {
      stopPlace();
      offStatus();
      offReject();
      offOverwrite();
      if (active === client) active = null;
      useEditorStore.getState().setHistoryPreview(null);
      client.stop();
    };
  }, [urlProject, identity, authStatus]);

  return {
    // No server project open (a building not saved yet): nothing connects, so nothing says
    // "Connecting".
    status: urlProject ? status : "local",
    ...identity,
    rejection,
    dismissRejection: () => {
      setRejection(null);
    },
    overwrite,
    keepMine: () => {
      if (overwrite) active?.keepMine(overwrite);
      setOverwrite(null);
    },
    dismissOverwrite: () => {
      setOverwrite(null);
    },
  };
}

/**
 * Disconnects from the open project at once, before anything else changes the building: a
 * connected client would send the next building as an edit to this project.
 */
export function leaveProject(): void {
  created = null;
  active?.stop();
  active = null;
  openProject(null);
}

/** Resolves once this tab has joined project `id` and shows its building. */
export function whenJoined(id: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (useEditorStore.getState().projectId === id) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      off();
      reject(new Error(`project ${id} did not open`));
    }, timeoutMs);
    const off = useEditorStore.subscribe((state) => {
      if (state.projectId !== id) return;
      window.clearTimeout(timer);
      off();
      resolve();
    });
  });
}

/** Switches the URL and lets useSync reconnect. */
export function openProject(id: string | null) {
  setProjectInUrl(id);
  window.dispatchEvent(new Event("bauwerk:project"));
}
