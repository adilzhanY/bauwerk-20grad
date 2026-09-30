import { useEffect, useMemo, useState } from "react";
import { loginPath } from "@/app/router";
import { fullName, useAuth } from "@/auth/store";
import { accessToken, authHeaders } from "@/auth/api";
import type { ProjectSummary as CardSummary } from "@/geometry/project";
import type { Building } from "@/geometry/types";
import { useEditorStore } from "@/store/building";
import type { HistoryPreview } from "@/store/building";
import { SyncClient, randomActor, syncConfigFromEnv } from "./client";
import type { Rejection, SyncStatus } from "./client";

export interface ProjectSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** The id of the building inside; older servers leave it out. */
  buildingId?: string;
  /** What the Projects page shows on the card; older servers leave it out. */
  summary?: CardSummary;
  owner?: string;
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

/** The client of the project open in this tab, for the history panel. */
let active: SyncClient | null = null;

export interface VersionEntry {
  version: number;
  actor: string;
  createdAt: string;
  kind: "create" | "ops";
  changes: number;
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

export async function createProject(): Promise<string | null> {
  const cfg = syncConfigFromEnv();
  if (!cfg) return null;
  const { actor } = actorIdentity();
  const res = await fetch(`${cfg.apiUrl}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor": actor, ...(await authHeaders()) },
    body: JSON.stringify({ building: useEditorStore.getState().building }),
  });
  if (!res.ok) return null;
  const project = (await res.json()) as { id: string };
  return project.id;
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
}

/** No connection: a page shown without a project on the server. */
export const LOCAL_SYNC: Sync = {
  status: "local",
  actor: "",
  color: "",
  rejection: null,
  dismissRejection: () => undefined,
};

/**
 * Keeps the project named in the address connected. Run once, by App, so a project stays
 * live on all its pages, not only in the editor: opening a project from the Projects page
 * waits for it to join.
 */
export function useSync(): Sync {
  const [status, setStatus] = useState<SyncStatus | "local">(syncEnabled ? "connecting" : "local");
  const [rejection, setRejection] = useState<Rejection | null>(null);
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
    const client = new SyncClient(useEditorStore, {
      ...cfg,
      projectId: urlProject,
      ...identity,
      ...(authStatus !== "off" ? { token: accessToken } : {}),
    });
    const offStatus = client.onStatus(setStatus);
    const offReject = client.onReject(setRejection);
    active = client;
    client.start();
    return () => {
      offStatus();
      offReject();
      if (active === client) active = null;
      useEditorStore.getState().setHistoryPreview(null);
      client.stop();
    };
  }, [urlProject, identity, authStatus]);

  return {
    status,
    ...identity,
    rejection,
    dismissRejection: () => {
      setRejection(null);
    },
  };
}

/**
 * Disconnects from the open project at once, before anything else changes the building: a
 * connected client would send the next building as an edit to this project.
 */
export function leaveProject(): void {
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
