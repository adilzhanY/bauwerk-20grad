import { receiveActivity, setActivitySender } from "./activity";
import type { ActivityEvent } from "./activity";
import { io } from "socket.io-client";
import { randomId } from "@/lib/ids";
import { can } from "@/projects/roles";
import type { Role } from "@/projects/roles";
import type { Building } from "@/geometry/types";
import { validateBuilding } from "@/geometry/export";
import type { ImportError } from "@/geometry/export";
import type { createEditorStore, Presence, Selection } from "@/store/building";
import type { Vec2 } from "@/geometry/types";
import { applyOps, diffBuilding, sameJson } from "./ops";
import type { Op, Path } from "./ops";
import { listenPresence, receiveView } from "./presence";
import type { DragPreview, SharedView } from "./presence";

/** How often a moving pointer or drag is sent, at most. */
const PRESENCE_MS = 50;

/**
 * Keeps one store in step with one project on the server, edit by edit.
 *
 * The client holds the building as the server last confirmed it, with its version, and a
 * queue of local batches the server has not confirmed yet. The editor shows the confirmed
 * building with the queue replayed on top, so a local edit shows at once.
 *
 * Local edits: every change to the store's building is diffed into operations (ops.ts),
 * queued as one batch with the next sequence number, and sent.
 *
 * Remote edits: the server sends every applied batch to every tab in version order, the
 * sender included. The client applies it to the confirmed building and replays its queue
 * on top. Its own batch leaves the queue when it comes back this way. A batch from someone
 * else is also applied to every undo and redo snapshot, so undo only takes back your own
 * edits and never someone else's.
 *
 * A gap in the versions, or a reconnect, joins again: the server answers with the building,
 * its version and the last batch of this tab it has, and the queue is resent from there.
 * A batch the server refuses (it would break an invariant) leaves the queue and is reported.
 */

/** The part of a Socket.IO client socket the sync client uses, so tests can bring a fake. */
export interface SocketLike {
  on(event: string, handler: (data: never) => void): unknown;
  emit(event: string, data: unknown, ack?: (response: never) => void): unknown;
  disconnect(): unknown;
}

export interface SyncConfig {
  /** Absolute, or relative to the page ("/collab" behind the dev proxy). */
  apiUrl: string;
  projectId: string;
  actor: string;
  color: string;
  /** The share link's token from the address, for someone who is not a member yet. */
  link?: string;
  /** One per editor tab. Random when left out. */
  clientId?: string;
  /** The access token to connect with, asked for on every (re)connect; accounts off: none. */
  token?: () => Promise<string | null>;
  /**
   * The building this tab created the project with (Save). Whatever the store changed since
   * goes to the server as this tab's first batch once it has joined, instead of being
   * replaced by the server's copy.
   */
  base?: Building;
  /** Opens the socket. Tests pass a fake. */
  connect?: (apiUrl: string, token?: () => Promise<string | null>) => SocketLike;
}

type Store = ReturnType<typeof createEditorStore>;

interface Batch {
  seq: number;
  ops: Op[];
  /** The building this tab showed after the batch passed every invariant. */
  valid: boolean;
}

interface OpsMessage {
  version: number;
  clientId: string;
  seq: number;
  actor: string;
  ops: Op[];
}

type JoinAck =
  | {
      ok: true;
      version: number;
      building: Building;
      lastSeq: number;
      role: Role;
      lastSeenAt?: string | null;
    }
  | { ok: false; reason: string };

type OpsAck =
  | { ok: true; version: number; duplicate: boolean }
  | { ok: false; reason: string; error?: ImportError };

interface PresenceMessage {
  actors: (Presence & { clientId: string })[];
}

/**
 * Someone else changed what this person had just changed (TODO Part 21, CH.2): their name and
 * each overwritten value, with this person's value to put back.
 */
export interface Overwrite {
  actor: string;
  changes: { path: Path; mine: unknown }[];
}

/** An own change counts as fresh for this long when someone else's lands on it. */
const FRESH_MS = 10_000;

/** Here, or away with the tab hidden for a while; which page of the project and which storey. */
export interface Place {
  state: "here" | "away";
  page: string | null;
  storeyId: string | null;
}

/** `noAccess`: signed in, but not a member and without a valid share link. */
export type SyncStatus = "connecting" | "online" | "offline" | "error" | "noAccess";

/** Why the server refused a local edit, for the message shown to the user. */
export interface Rejection {
  reason: string;
  error?: ImportError;
}

/** Opens a Socket.IO connection to the server under `apiUrl`, which may carry a path. */
export function openSocket(apiUrl: string, token?: () => Promise<string | null>): SocketLike {
  const url = new URL(apiUrl, window.location.href);
  return io(url.origin, {
    path: `${url.pathname.replace(/\/$/, "")}/socket.io`,
    // A function, so every reconnect sends the token as it is then, refreshed or not.
    ...(token
      ? {
          auth: (cb: (data: object) => void) => {
            void token().then((value) => {
              cb(value ? { token: value } : {});
            });
          },
        }
      : {}),
  });
}

export class SyncClient {
  readonly clientId: string;
  status: SyncStatus = "connecting";
  private confirmed: Building | null = null;
  private confirmedVersion = 0;
  private pending: Batch[] = [];
  private seq = 0;
  /** The store's building as the client last saw it; local edits are diffed against it. */
  private shown: Building | null = null;
  private applying = false;
  private joined = false;
  /** Batches that arrived while a join was on its way, replayed once it answers. */
  private early: OpsMessage[] = [];
  private socket: SocketLike | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSelection: string | null = null;
  private stopped = false;
  private readonly statusListeners = new Set<(s: SyncStatus) => void>();
  private readonly rejectListeners = new Set<(r: Rejection) => void>();
  /** The last pointer or drag message waiting for its slot, per event. */
  private readonly latest = new Map<string, unknown>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private dragEndWaiting = false;
  /** An old version is on screen; the live building waits behind it. */
  private previewing = false;
  /**
   * Batches not yet confirmed, kept in this browser per project (TODO Part 21, CH.1) so a
   * tab closed while offline sends them the next time the project opens. ponytail: two tabs
   * of one project offline at once can both send the same edits; per-tab queues if it shows.
   */
  private readonly queueKey: string;
  private restored: Op[][] = [];
  /** Own values set in the last moments, by path, for noticing an overwrite. */
  private readonly recent = new Map<string, { value: unknown; at: number }>();
  private readonly overwriteListeners = new Set<(o: Overwrite) => void>();
  /** Here or away, and where in the project, as last reported (TODO Part 21, CC.1). */
  private place: Place = { state: "here", page: null, storeyId: null };
  /** Other people's edits that arrived during a preview, for the history on the way back. */
  private previewRebases: ((snapshot: Building) => Building)[] = [];

  constructor(
    private readonly store: Store,
    private readonly config: SyncConfig,
  ) {
    this.clientId = config.clientId ?? randomId();
    this.queueKey = `bauwerk.queue.${config.projectId}`;
    this.restored = readQueue(this.queueKey);
  }

  onOverwrite(listener: (o: Overwrite) => void): () => void {
    this.overwriteListeners.add(listener);
    return () => this.overwriteListeners.delete(listener);
  }

  /** Puts this person's values back after an overwrite: one ordinary change of theirs. */
  keepMine(overwrite: Overwrite): void {
    const ops: Op[] = overwrite.changes.map((c) => ({ op: "set", path: c.path, value: c.mine }));
    const next = applyOps(this.store.getState().building, ops).value;
    this.store.setState({ building: next });
  }

  private saveQueue() {
    try {
      if (this.pending.length === 0) localStorage.removeItem(this.queueKey);
      else localStorage.setItem(this.queueKey, JSON.stringify(this.pending.map((b) => b.ops)));
    } catch {
      // Storage full or blocked: the queue stays in memory, as before.
    }
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onReject(listener: (r: Rejection) => void): () => void {
    this.rejectListeners.add(listener);
    return () => this.rejectListeners.delete(listener);
  }

  /** Local batches the server has not confirmed yet. */
  get unconfirmed(): number {
    return this.pending.length;
  }

  get version(): number {
    return this.confirmedVersion;
  }

  /** Connects, joins the project and starts watching the store. */
  start(): void {
    const socket = (this.config.connect ?? openSocket)(this.config.apiUrl, this.config.token);
    this.socket = socket;
    socket.on("connect", () => {
      this.join();
    });
    // The server turned the connection away: no valid token (signed out, or it expired).
    socket.on("connect_error", (error: Error) => {
      if (error.message === "signIn") this.setStatus("error");
    });
    socket.on("disconnect", () => {
      this.joined = false;
      this.setStatus("offline");
      this.store.getState().setPresence([]);
    });
    // The owner changed this person's role, or took them out of the project.
    socket.on("access", (message: { projectId: string; role: Role | null }) => {
      if (message.projectId !== this.config.projectId) return;
      if (message.role) this.store.getState().setProjectRole(message.role);
      else {
        this.joined = false;
        this.setStatus("noAccess");
      }
    });
    // Someone wrote in a thread: the threads are loaded again (projects/threads.ts).
    socket.on("threads", () => {
      window.dispatchEvent(new Event("bauwerk:threads"));
    });
    // A file was added, replaced or removed, here or by someone else: the file list and the
    // pictures on the walls and storeys follow (projects/files.ts, projects/photoSync.ts).
    socket.on("files", () => {
      window.dispatchEvent(new Event("bauwerk:files"));
    });
    // Someone else applied a floor plan, a facade or a version: a short toast says so.
    socket.on("activity", (message: ActivityEvent) => {
      receiveActivity(message);
    });
    setActivitySender((activity) => {
      if (this.joined) socket.emit("activity", { activity });
    });
    socket.on("ops", (message: OpsMessage) => {
      this.receive(message);
    });
    socket.on("presence", (message: PresenceMessage) => {
      // The list comes on every join and leave; keep what is known of the others' pointers.
      const known = new Map(this.store.getState().presence.map((p) => [p.clientId, p]));
      this.store.getState().setPresence(
        message.actors
          .filter((a) => a.clientId !== this.clientId)
          .map((a) => {
            const before = known.get(a.clientId);
            return { ...a, cursor: before?.cursor ?? null, dragging: before?.dragging ?? null };
          }),
      );
    });
    socket.on("cursor", (message: { clientId: string; cursor: Vec2 | null }) => {
      this.store.getState().patchPresence(message.clientId, { cursor: message.cursor });
    });
    socket.on("view", (message: SharedView & { clientId: string }) => {
      receiveView(message.clientId, message);
    });
    socket.on("drag", (message: { clientId: string; dragging: DragPreview | null }) => {
      this.store.getState().patchPresence(message.clientId, { dragging: message.dragging });
    });
    listenPresence({
      cursor: (point) => {
        this.throttled("cursor", { cursor: point }, point === null);
      },
      view: (view) => {
        if (this.store.getState().presence.length > 0) this.throttled("view", view, false);
      },
      drag: (drag) => {
        // A drag that ended in a move says so only once the move is confirmed: the server
        // passes presence on at once but writes the move first, and the others would see
        // the opening jump back for a moment.
        this.dragEndWaiting = drag === null && this.pending.length > 0;
        if (this.dragEndWaiting) {
          const timer = this.timers.get("drag");
          if (timer) clearTimeout(timer);
          this.timers.delete("drag");
          this.latest.delete("drag");
          return;
        }
        this.throttled("drag", { dragging: drag }, drag === null);
      },
    });
    socket.on("selection", (message: { clientId: string; selection: Selection | null }) => {
      const presence = this.store
        .getState()
        .presence.map((p) =>
          p.clientId === message.clientId ? { ...p, selection: message.selection } : p,
        );
      this.store.getState().setPresence(presence);
    });

    this.unsubscribe = this.store.subscribe((state, prev) => {
      if (state.building !== this.shown && !this.applying) {
        // A language switch only translates the names the app made, on this screen: it is
        // nobody's edit, and the project keeps its names for everyone else.
        if (state.language !== prev.language) this.shown = state.building;
        else this.local(state.building);
      }
      const selection = JSON.stringify(state.selection);
      if (selection !== this.lastSelection) {
        this.lastSelection = selection;
        if (this.joined) this.socket?.emit("selection", { selection: state.selection });
      }
    });
  }

  /** Where this person is in the project; sent when it changes, and again on every join. */
  report(place: Place): void {
    if (
      place.state === this.place.state &&
      place.page === this.place.page &&
      place.storeyId === this.place.storeyId
    )
      return;
    this.place = place;
    if (this.joined) this.socket?.emit("status", place);
  }

  stop(): void {
    this.stopped = true;
    listenPresence(null);
    setActivitySender(null);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.unsubscribe?.();
    this.socket?.disconnect();
    this.store.getState().setPresence([]);
    this.store.getState().setProjectId(null);
  }

  /**
   * Sends a pointer or drag update at most every PRESENCE_MS: the first at once, then the
   * newest one when the slot opens. `now` sends immediately (the drag ended, the pointer left).
   */
  private throttled(event: string, data: unknown, now: boolean) {
    if (!this.joined) return;
    const timer = this.timers.get(event);
    if (now) {
      if (timer) clearTimeout(timer);
      this.timers.delete(event);
      this.latest.delete(event);
      this.socket?.emit(event, data);
      return;
    }
    if (timer) {
      this.latest.set(event, data);
      return;
    }
    this.socket?.emit(event, data);
    const tick = () => {
      if (this.latest.has(event)) {
        this.socket?.emit(event, this.latest.get(event));
        this.latest.delete(event);
        this.timers.set(event, setTimeout(tick, PRESENCE_MS));
      } else {
        this.timers.delete(event);
      }
    };
    this.timers.set(event, setTimeout(tick, PRESENCE_MS));
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private join() {
    this.joined = false;
    this.early = [];
    this.socket?.emit(
      "join",
      {
        projectId: this.config.projectId,
        clientId: this.clientId,
        actor: this.config.actor,
        color: this.config.color,
        ...(this.config.link ? { link: this.config.link } : {}),
      },
      (ack: JoinAck) => {
        if (this.stopped) return;
        if (!ack.ok) {
          this.setStatus(ack.reason === "notMember" ? "noAccess" : "error");
          return;
        }
        this.store.getState().setProjectRole(ack.role);
        this.joined = true;
        const first = this.confirmed === null;
        const before = this.confirmed;
        this.confirmed = ack.building;
        this.confirmedVersion = ack.version;
        // Batches the server already has are part of the snapshot.
        this.pending = this.pending.filter((batch) => batch.seq > ack.lastSeq);
        this.saveQueue();
        const early = this.early;
        this.early = [];
        // A fresh project starts with an empty history; after a reconnect the history
        // takes in whatever changed while this tab was away.
        const missed = before ? diffBuilding(before, ack.building) : [];
        // Edits made after Save and before this join (config.base).
        const sinceSave =
          first && this.config.base
            ? diffBuilding(this.config.base, this.store.getState().building)
            : [];
        this.show(first ? null : missed.length > 0 ? rebaseWith(missed) : undefined);
        if (first) {
          this.store.getState().setProjectId(this.config.projectId);
          this.store.getState().setLastSeenAt(ack.lastSeenAt ?? null);
        }
        for (const message of early) this.receive(message);
        for (const batch of this.pending) this.send(batch);
        // What a tab closed while offline left unsent: applied now as this person's change.
        const restored = [...this.restored.flat(), ...sinceSave];
        this.restored = [];
        if (first && restored.length > 0 && can(ack.role, "edit")) {
          this.store.setState({
            building: applyOps(this.store.getState().building, restored).value,
          });
        }
        this.socket?.emit("selection", { selection: this.store.getState().selection });
        this.socket?.emit("status", this.place);
        this.setStatus("online");
      },
    );
  }

  /** A change the user made: one batch of operations against what was shown before. */
  private local(building: Building) {
    const before = this.shown;
    this.shown = building;
    // A preview is read only: what is changed in it is dropped on the way back. A viewer or
    // commenter sends nothing either; the store takes the change back (store/history.ts).
    if (this.previewing || !before || !this.confirmed) return;
    const role = this.store.getState().projectRole;
    if (role && !can(role, "edit")) return;
    const ops = diffBuilding(before, building);
    if (ops.length === 0) return;
    this.seq += 1;
    const batch = { seq: this.seq, ops, valid: validateBuilding(building) === null };
    this.pending.push(batch);
    this.saveQueue();
    const now = Date.now();
    for (const op of ops) {
      if (op.op === "set") this.recent.set(JSON.stringify(op.path), { value: op.value, at: now });
    }
    if (this.joined) this.send(batch);
  }

  private send(batch: Batch) {
    this.socket?.emit("ops", batch, (ack: OpsAck) => {
      if (ack.ok || this.stopped) return;
      // Refused: take it out of the queue and show the building without it.
      if (!this.pending.includes(batch)) return;
      this.pending = this.pending.filter((b) => b !== batch);
      this.saveQueue();
      this.endDragWhenSettled();
      this.show(undefined);
      const rejection: Rejection = ack.error
        ? { reason: ack.reason, error: ack.error }
        : { reason: ack.reason };
      for (const listener of this.rejectListeners) listener(rejection);
    });
  }

  private receive(message: OpsMessage) {
    if (!this.joined || !this.confirmed) {
      this.early.push(message);
      return;
    }
    if (message.version <= this.confirmedVersion) return;
    if (message.version > this.confirmedVersion + 1) {
      // A batch went missing; start again from a fresh snapshot.
      this.join();
      return;
    }
    this.confirmed = applyOps(this.confirmed, message.ops).value;
    this.confirmedVersion = message.version;
    if (message.clientId === this.clientId) {
      const head = this.pending[0];
      this.pending = this.pending.filter((batch) => batch.seq > message.seq);
      this.saveQueue();
      this.endDragWhenSettled();
      // Our oldest batch came back whole: confirmed plus the queue is what is shown already.
      if (head?.seq === message.seq && head.ops.length === message.ops.length) return;
      this.show(undefined);
      return;
    }
    this.noticeOverwrite(message);
    this.show(rebaseWith(message.ops));
  }

  /** Someone else's batch set a value this person set moments ago to something else. */
  private noticeOverwrite(message: OpsMessage) {
    const now = Date.now();
    const changes: Overwrite["changes"] = [];
    for (const op of message.ops) {
      if (op.op !== "set") continue;
      const key = JSON.stringify(op.path);
      const mine = this.recent.get(key);
      if (!mine) continue;
      this.recent.delete(key);
      if (now - mine.at <= FRESH_MS && !sameJson(mine.value, op.value)) {
        changes.push({ path: op.path, mine: mine.value });
      }
    }
    if (changes.length === 0) return;
    for (const listener of this.overwriteListeners) listener({ actor: message.actor, changes });
  }

  /**
   * Shows an old version instead of the live building, or, with null, goes back to live.
   * Other people's edits keep arriving underneath and reach the history on the way back.
   */
  preview(building: Building | null): void {
    if (building) {
      this.previewing = true;
      this.applying = true;
      try {
        this.store.getState().applyRemoteBuilding(building);
      } finally {
        this.applying = false;
      }
      this.shown = this.store.getState().building;
      return;
    }
    if (!this.previewing) return;
    this.previewing = false;
    const rebases = this.previewRebases;
    this.previewRebases = [];
    this.show(
      rebases.length > 0
        ? (snapshot) => rebases.reduce((b, rebase) => rebase(b), snapshot)
        : undefined,
    );
  }

  /** Sends the held back end of a drag once every local batch is confirmed or refused. */
  private endDragWhenSettled() {
    if (!this.dragEndWaiting || this.pending.length > 0) return;
    this.dragEndWaiting = false;
    this.throttled("drag", { dragging: null }, true);
  }

  /** Puts confirmed plus the queue into the store, outside the undo history. */
  private show(rebase: ((snapshot: Building) => Building) | null | undefined) {
    if (!this.confirmed) return;
    if (this.previewing) {
      if (rebase) this.previewRebases.push(rebase);
      return;
    }
    let building = this.confirmed;
    for (const batch of this.pending) building = applyOps(building, batch.ops).value;
    this.applying = true;
    try {
      this.store.getState().applyRemoteBuilding(building, rebase);
    } finally {
      this.applying = false;
    }
    this.shown = this.store.getState().building;
  }
}

/** The queue a tab of this project left in this browser, or nothing. */
function readQueue(key: string): Op[][] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((b): b is Op[] => Array.isArray(b)) : [];
  } catch {
    return [];
  }
}

/** Applies someone else's operations to an undo or redo snapshot. */
function rebaseWith(ops: Op[]): (snapshot: Building) => Building {
  return (snapshot) => applyOps(snapshot, ops).value;
}

/** Sync is on when the client is built with VITE_API_URL. */
export function syncConfigFromEnv(): { apiUrl: string } | null {
  const url = import.meta.env.VITE_API_URL as string | undefined;
  return url ? { apiUrl: url.replace(/\/$/, "") } : null;
}

export function randomActor(): { actor: string; color: string } {
  const names = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Barbara", "Edsger", "Hedy"];
  const colors = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#6c8ef5", "#b084cc"];
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)] as T;
  return { actor: `${pick(names)} ${Math.floor(Math.random() * 90 + 10)}`, color: pick(colors) };
}
