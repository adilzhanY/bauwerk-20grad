/**
 * A signed in user's own data, kept on the server as well as in this browser (TODO Part 20,
 * AE.5): the settings, the bookmarked buildings, and per LoD2 building the note and the facade
 * survey. Signed out, everything stays in the browser as before.
 *
 * On signing in the two are merged: what the server has wins, and what only this browser has
 * goes up, so nothing typed before signing in is lost. From then on every change is sent.
 * Failed sends are not retried on their own; the next change to the same thing sends it again.
 * Signing out first sends what is still waiting; what still does not get there is kept for
 * that account only, and goes up when it signs in again.
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
/** Per account: the notes and surveys a sign out could not send (`unsent.<user id>`). */
const UNSENT_KEY = "bauwerk.unsent.";

const surveySchema = z.custom<BuildingSurvey>((v) => typeof v === "object" && v !== null);

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
      survey: surveySchema.nullable(),
    }),
  ),
});

type ServerData = z.infer<typeof serverDataSchema>;

const unsentSchema = z.object({
  notes: z.record(z.string(), z.string()),
  surveys: z.record(z.string(), surveySchema.nullable()),
});
type Unsent = z.infer<typeof unsentSchema>;

const signedIn = () => useAuth.getState().status === "signedIn" && apiBase() !== null;

/**
 * Sends a change while signed in. `headers` are the ones taken when the change was made: a
 * send held back by `later` may go after signing out, when the token is gone. False when it
 * did not get there.
 */
async function send(
  method: "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers?: Promise<Record<string, string>>,
): Promise<boolean> {
  const base = apiBase();
  if (!base || (!headers && !signedIn())) return true;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(await (headers ?? authHeaders())),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok;
  } catch {
    // Offline: the next change sends it again.
    return false;
  }
}

/** Waits a moment after the last call per key, so typing sends once and not per key press. */
const timers = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; run: () => Promise<void> }
>();
const running = new Set<Promise<void>>();
function start(run: () => Promise<void>) {
  const done = run().finally(() => running.delete(done));
  running.add(done);
}
function later(key: string, run: () => Promise<void>, ms = 600) {
  const old = timers.get(key);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => {
    timers.delete(key);
    start(run);
  }, ms);
  timers.set(key, { timer, run });
}
/** Sends at once what waits for typing to stop, and waits for every send on its way. */
async function flush(): Promise<void> {
  for (const { timer, run } of timers.values()) {
    clearTimeout(timer);
    start(run);
  }
  timers.clear();
  await Promise.all(running);
}

/** The notes and surveys whose last send failed, by building: a sign out keeps them. */
const unsentNotes = new Map<string, string>();
const unsentSurveys = new Map<string, BuildingSurvey | null>();

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
  if (!signedIn()) return;
  const headers = authHeaders();
  later(`note:${gid}`, async () => {
    const path = `/me/buildings/${encodeURIComponent(gid)}`;
    if (await send("PUT", path, { note: note === "" ? null : note }, headers))
      unsentNotes.delete(gid);
    else unsentNotes.set(gid, note);
  });
}

export function syncProjectsView(view: string): void {
  void send("PUT", "/me/settings", { projectsView: view });
}

function syncSurvey(gid: string, survey: BuildingSurvey | null): void {
  const headers = authHeaders();
  later(`survey:${gid}`, async () => {
    if (await send("PUT", `/me/buildings/${encodeURIComponent(gid)}`, { survey }, headers))
      unsentSurveys.delete(gid);
    else unsentSurveys.set(gid, survey);
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
  let surveys = { ...useSurvey.getState().buildings };
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

  // What this account's last sign out could not send: newer than the server's, so it wins.
  const id = useAuth.getState().account?.id;
  const unsent = id ? readUnsent(id) : null;
  if (id && unsent) {
    for (const [gid, note] of Object.entries(unsent.notes)) {
      write(NOTE_KEY + gid, note);
      syncNote(gid, note);
    }
    for (const [gid, survey] of Object.entries(unsent.surveys)) {
      surveys = survey
        ? { ...surveys, [gid]: survey }
        : Object.fromEntries(Object.entries(surveys).filter(([key]) => key !== gid));
      syncSurvey(gid, survey);
    }
    localStorage.removeItem(UNSENT_KEY + id);
  }
  merging = true;
  useSurvey.setState({ buildings: surveys });
  merging = false;
  try {
    localStorage.setItem(SURVEY_KEY, JSON.stringify(surveys));
  } catch {
    // Blocked storage: the server keeps it.
  }
}

function readUnsent(userId: string): Unsent | null {
  try {
    const parsed = unsentSchema.safeParse(JSON.parse(read(UNSENT_KEY + userId) ?? "null"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Signing out leaves none of the account's bookmarks, notes and surveys where the next sign
 * in, maybe someone else's, would take them up into that account. What still waits to be sent
 * goes first; what does not get there is kept under this account's id only, as it is nowhere
 * else, and goes up when the same account signs in again.
 */
async function clearUserData(userId: string | undefined): Promise<void> {
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
  await flush();
  if (!userId || (unsentNotes.size === 0 && unsentSurveys.size === 0)) return;
  const kept = readUnsent(userId) ?? { notes: {}, surveys: {} };
  write(
    UNSENT_KEY + userId,
    JSON.stringify({
      notes: { ...kept.notes, ...Object.fromEntries(unsentNotes) },
      surveys: { ...kept.surveys, ...Object.fromEntries(unsentSurveys) },
    }),
  );
  unsentNotes.clear();
  unsentSurveys.clear();
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
    if (state.status === "signedOut" && prev.status === "signedIn")
      void clearUserData(prev.account?.id);
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
