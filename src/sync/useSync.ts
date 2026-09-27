import { useEffect, useMemo, useState } from "react";
import { loginPath } from "@/app/router";
import { useAuth } from "@/auth/store";
import { accessToken, accountsEnabled, authHeaders } from "@/auth/supabase";
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
}

const ACTOR_KEY = "bauwerk.actor";

/**
 * Who this tab is. Kept per tab (sessionStorage), so two tabs side by side are two people,
 * and a reload keeps the name.
 */
function actorIdentity(): { actor: string; color: string } {
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
export function useSync(): {
  status: SyncStatus | "local";
  actor: string;
  color: string;
  rejection: Rejection | null;
  dismissRejection: () => void;
} {
  const [status, setStatus] = useState<SyncStatus | "local">(syncEnabled ? "connecting" : "local");
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [tabIdentity] = useState(actorIdentity);
  const [urlProject, setUrlProject] = useState(projectIdFromUrl);
  const authStatus = useAuth((s) => s.status);
  const account = useAuth((s) => s.account);
  // Signed in, people are their account: the name and colour everyone else sees too.
  const identity = useMemo(
    () => (account ? { actor: account.username, color: account.color } : tabIdentity),
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
    if (accountsEnabled && authStatus !== "signedIn") {
      // A shared link needs an account: sign in, then come back to it.
      if (authStatus === "signedOut") window.location.assign(loginPath());
      return;
    }
    const client = new SyncClient(useEditorStore, {
      ...cfg,
      projectId: urlProject,
      ...identity,
      ...(accountsEnabled ? { token: accessToken } : {}),
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

/** Switches the URL and lets useSync reconnect. */
export function openProject(id: string | null) {
  setProjectInUrl(id);
  window.dispatchEvent(new Event("bauwerk:project"));
}
