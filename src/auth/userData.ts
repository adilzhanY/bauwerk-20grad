/**
 * A signed in user's own data, kept on the server as well as in this browser (TODO Part 20,
 * AE.5): the settings, the bookmarked buildings, and per LoD2 building the note and the facade
 * survey. Signed out, everything stays in the browser as before.
 *
 * On signing in the two are merged: what the server has wins, and what only this browser has
 * goes up, so nothing typed before signing in is lost. From then on every change is sent.
 * Failed sends are not retried on their own; the next change to the same thing sends it again.
 */
import { z } from "zod";
import { useEditorStore } from "@/store/building";
import { useSurvey } from "@/lod2/state/survey";
import type { BuildingSurvey } from "@/lod2/state/survey";
import { apiBase, authHeaders } from "./api";
import { useAuth } from "./store";

const BOOKMARKS_KEY = "bauwerk.bookmarks";
const NOTE_KEY = "bauwerk.notes.";
const VIEW_KEY = "bauwerk.projectsView";
const SURVEY_KEY = "lod2.survey.v1";

/** The reply of GET /me. A survey is taken as the server stored it, an object. */
const serverDataSchema = z.object({
  settings: z.object({
    language: z.enum(["en", "de"]).nullish(),
    theme: z.enum(["light", "dark", "system"]).nullish(),
    projectsView: z.string().nullish(),
  }),
  bookmarks: z.array(z.string()),
  buildings: z.array(
    z.object({
      gid: z.string(),
      note: z.string().nullable(),
      survey: z.custom<BuildingSurvey>((v) => typeof v === "object" && v !== null).nullable(),
    }),
  ),
});

type ServerData = z.infer<typeof serverDataSchema>;

const signedIn = () => useAuth.getState().status === "signedIn" && apiBase() !== null;

async function send(method: "PUT" | "DELETE", path: string, body?: unknown): Promise<void> {
  const base = apiBase();
  if (!base || !signedIn()) return;
  try {
    await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(await authHeaders()),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Offline: the next change sends it again.
  }
}

/** Waits a moment after the last call per key, so typing sends once and not per key press. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function later(key: string, run: () => void, ms = 600) {
  const old = timers.get(key);
  if (old) clearTimeout(old);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      run();
    }, ms),
  );
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the server keeps it.
  }
};

// --- What the rest of the app calls ----------------------------------------------------------

export function syncBookmark(gid: string, on: boolean): void {
  void send(on ? "PUT" : "DELETE", `/me/bookmarks/${encodeURIComponent(gid)}`);
}

export function syncNote(gid: string, note: string): void {
  later(`note:${gid}`, () => {
    void send("PUT", `/me/buildings/${encodeURIComponent(gid)}`, {
      note: note === "" ? null : note,
    });
  });
}

export function syncProjectsView(view: string): void {
  void send("PUT", "/me/settings", { projectsView: view });
}

function syncSurvey(gid: string, survey: BuildingSurvey | null): void {
  later(`survey:${gid}`, () => {
    void send("PUT", `/me/buildings/${encodeURIComponent(gid)}`, { survey });
  });
}

// --- Merging on sign in ------------------------------------------------------------------------

function localBookmarks(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(BOOKMARKS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function pull(): Promise<ServerData | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/me`, { headers: await authHeaders() });
    if (!res.ok) return null;
    const data = serverDataSchema.safeParse(await res.json());
    return data.success ? data.data : null;
  } catch {
    return null;
  }
}

/** Brings server and browser together after signing in. */
export async function mergeUserData(): Promise<void> {
  const data = await pull();
  if (!data) return;
  const editor = useEditorStore.getState();

  // Settings: the account's choice, or this browser's when the account has none yet.
  const s = data.settings;
  if (s.language) editor.setLanguage(s.language);
  if (s.theme) editor.setTheme(s.theme);
  if (s.projectsView) write(VIEW_KEY, s.projectsView);
  const missing: Record<string, string> = {};
  if (!s.language) missing.language = editor.language;
  if (!s.theme) missing.theme = editor.theme;
  const view = read(VIEW_KEY);
  if (!s.projectsView && view) missing.projectsView = view;
  if (Object.keys(missing).length > 0) void send("PUT", "/me/settings", missing);

  // Bookmarks: both sets together.
  const local = localBookmarks();
  for (const gid of local) if (!data.bookmarks.includes(gid)) syncBookmark(gid, true);
  write(BOOKMARKS_KEY, JSON.stringify([...new Set([...data.bookmarks, ...local])]));

  // Notes and surveys, building by building.
  const onServer = new Map(data.buildings.map((b) => [b.gid, b]));
  const surveys = { ...useSurvey.getState().buildings };
  for (const b of data.buildings) {
    if (b.note !== null) write(NOTE_KEY + b.gid, b.note);
    if (b.survey !== null) surveys[b.gid] = b.survey;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(NOTE_KEY)) continue;
    const gid = key.slice(NOTE_KEY.length);
    const note = read(key);
    if (note && !onServer.get(gid)?.note) syncNote(gid, note);
  }
  for (const [gid, survey] of Object.entries(useSurvey.getState().buildings))
    if (!onServer.get(gid)?.survey) syncSurvey(gid, survey);
  merging = true;
  useSurvey.setState({ buildings: surveys });
  merging = false;
  try {
    localStorage.setItem(SURVEY_KEY, JSON.stringify(surveys));
  } catch {
    // Blocked storage: the server keeps it.
  }
}

/**
 * Signing out leaves none of the account's bookmarks, notes and surveys in this browser: the
 * next sign in, maybe someone else's, would take them up into that account.
 */
function clearUserData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === BOOKMARKS_KEY || key === SURVEY_KEY || key?.startsWith(NOTE_KEY)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Blocked storage: nothing was kept.
  }
  useSurvey.setState({ buildings: {} });
}

// --- Following changes ---------------------------------------------------------------------------

let merging = false;
let started = false;

/** Call once at start: merges on every sign in and sends every change while signed in. */
export function startUserData(): void {
  if (started) return;
  started = true;
  useAuth.subscribe((state, prev) => {
    if (state.status === "signedIn" && prev.status !== "signedIn") void mergeUserData();
    if (state.status === "signedOut" && prev.status === "signedIn") clearUserData();
  });
  useEditorStore.subscribe((state, prev) => {
    if (!signedIn()) return;
    const patch: Record<string, string> = {};
    if (state.language !== prev.language) patch.language = state.language;
    if (state.theme !== prev.theme) patch.theme = state.theme;
    if (Object.keys(patch).length > 0) void send("PUT", "/me/settings", patch);
  });
  useSurvey.subscribe((state, prev) => {
    if (merging || !signedIn()) return;
    for (const [gid, survey] of Object.entries(state.buildings))
      if (prev.buildings[gid] !== survey) syncSurvey(gid, survey);
    for (const gid of Object.keys(prev.buildings))
      if (!(gid in state.buildings)) syncSurvey(gid, null);
  });
}
