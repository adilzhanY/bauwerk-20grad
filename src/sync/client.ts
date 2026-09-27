import { io } from "socket.io-client";
import type { Building } from "@/geometry/types";
import { validateBuilding } from "@/geometry/export";
import type { ImportError } from "@/geometry/export";
import type { createEditorStore, Presence, Selection } from "@/store/building";
import type { Vec2 } from "@/geometry/types";
import { applyOps, diffBuilding } from "./ops";
import type { Op } from "./ops";
import { listenPresence } from "./presence";
import type { DragPreview } from "./presence";

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
  /** One per editor tab. Random when left out. */
  clientId?: string;
  /** Opens the socket. Tests pass a fake. */
  connect?: (apiUrl: string) => SocketLike;
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
  | { ok: true; version: number; building: Building; lastSeq: number }
  | { ok: false; reason: string };

type OpsAck =
  | { ok: true; version: number; duplicate: boolean }
  | { ok: false; reason: string; error?: ImportError };

interface PresenceMessage {
  actors: (Presence & { clientId: string })[];
}

export type SyncStatus = "connecting" | "online" | "offline" | "error";

/** Why the server refused a local edit, for the message shown to the user. */
export interface Rejection {
  reason: string;
  error?: ImportError;
}

/** Opens a Socket.IO connection to the server under `apiUrl`, which may carry a path. */
function openSocket(apiUrl: string): SocketLike {
  const url = new URL(apiUrl, window.location.href);
  return io(url.origin, { path: `${url.pathname.replace(/\/$/, "")}/socket.io` });
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
  /** Other people's edits that arrived during a preview, for the history on the way back. */
  private previewRebases: ((snapshot: Building) => Building)[] = [];

  constructor(
    private readonly store: Store,
    private readonly config: SyncConfig,
  ) {
    this.clientId = config.clientId ?? randomId();
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
    const socket = (this.config.connect ?? openSocket)(this.config.apiUrl);
    this.socket = socket;
    socket.on("connect", () => {
      this.join();
    });
    socket.on("disconnect", () => {
      this.joined = false;
      this.setStatus("offline");
      this.store.getState().setPresence([]);
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
    socket.on("drag", (message: { clientId: string; dragging: DragPreview | null }) => {
      this.store.getState().patchPresence(message.clientId, { dragging: message.dragging });
    });
    listenPresence({
      cursor: (point) => {
        this.throttled("cursor", { cursor: point }, point === null);
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

    this.unsubscribe = this.store.subscribe((state) => {
      if (state.building !== this.shown && !this.applying) this.local(state.building);
      const selection = JSON.stringify(state.selection);
      if (selection !== this.lastSelection) {
        this.lastSelection = selection;
        if (this.joined) this.socket?.emit("selection", { selection: state.selection });
      }
    });
  }

  stop(): void {
    this.stopped = true;
    listenPresence(null);
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
      },
      (ack: JoinAck) => {
        if (this.stopped) return;
        if (!ack.ok) {
          this.setStatus("error");
          return;
        }
        this.joined = true;
        const first = this.confirmed === null;
        const before = this.confirmed;
        this.confirmed = ack.building;
        this.confirmedVersion = ack.version;
        // Batches the server already has are part of the snapshot.
        this.pending = this.pending.filter((batch) => batch.seq > ack.lastSeq);
        const early = this.early;
        this.early = [];
        // A fresh project starts with an empty history; after a reconnect the history
        // takes in whatever changed while this tab was away.
        const missed = before ? diffBuilding(before, ack.building) : [];
        this.show(first ? null : missed.length > 0 ? rebaseWith(missed) : undefined);
        if (first) this.store.getState().setProjectId(this.config.projectId);
        for (const message of early) this.receive(message);
        for (const batch of this.pending) this.send(batch);
        this.socket?.emit("selection", { selection: this.store.getState().selection });
        this.setStatus("online");
      },
    );
  }

  /** A change the user made: one batch of operations against what was shown before. */
  private local(building: Building) {
    const before = this.shown;
    this.shown = building;
    // A preview is read only: what is changed in it is dropped on the way back.
    if (this.previewing || !before || !this.confirmed) return;
    const ops = diffBuilding(before, building);
    if (ops.length === 0) return;
    this.seq += 1;
    const batch = { seq: this.seq, ops, valid: validateBuilding(building) === null };
    this.pending.push(batch);
    if (this.joined) this.send(batch);
  }

  private send(batch: Batch) {
    this.socket?.emit("ops", batch, (ack: OpsAck) => {
      if (ack.ok || this.stopped) return;
      // Refused: take it out of the queue and show the building without it.
      if (!this.pending.includes(batch)) return;
      this.pending = this.pending.filter((b) => b !== batch);
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
      this.endDragWhenSettled();
      // Our oldest batch came back whole: confirmed plus the queue is what is shown already.
      if (head?.seq === message.seq && head.ops.length === message.ops.length) return;
      this.show(undefined);
      return;
    }
    this.show(rebaseWith(message.ops));
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

/** Applies someone else's operations to an undo or redo snapshot. */
function rebaseWith(ops: Op[]): (snapshot: Building) => Building {
  return (snapshot) => applyOps(snapshot, ops).value;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
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
