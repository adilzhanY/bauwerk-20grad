/**
 * An in-memory stand-in for the collaboration server, for tests. It follows the server's
 * rules exactly where they matter for convergence: one order of batches per project, the
 * same `applyOps`, the same invariant check, a resent batch applied once, and every batch
 * sent to every tab in that order. Messages wait in queues until the test delivers them,
 * one connection at a time in its own order (as Socket.IO keeps it) and interleaved across
 * connections in any order the test picks, so races can be played out deterministically.
 */
import type { Building } from "@/geometry/types";
import { checkBuildingShape, validateBuilding } from "@/geometry/export";
import { applyOps } from "./ops";
import type { Op } from "./ops";
import type { SocketLike } from "./client";

type Handler = (data: never) => void;
type Ack = (response: never) => void;

export class FakeSocket implements SocketLike {
  /** Messages to the server, not yet processed. */
  readonly outbox: { event: string; data: unknown; ack?: Ack }[] = [];
  /** Messages to the client, not yet delivered. */
  readonly inbox: (() => void)[] = [];
  online = true;
  clientId: string | null = null;
  actor = "";
  private readonly handlers = new Map<string, Handler[]>();

  constructor(private readonly hub: TestHub) {
    this.receive("connect", undefined);
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  emit(event: string, data: unknown, ack?: Ack) {
    if (this.online) this.outbox.push(ack ? { event, data, ack } : { event, data });
  }

  disconnect() {
    this.drop();
  }

  /** The connection breaks: what is in flight either way is lost. */
  drop() {
    if (!this.online) return;
    this.online = false;
    this.outbox.length = 0;
    this.inbox.length = 0;
    this.hub.leave(this);
    this.fire("disconnect", undefined);
  }

  /** The connection comes back, as Socket.IO's reconnect does. */
  restore() {
    this.online = true;
    this.receive("connect", undefined);
  }

  /** Queues a message for the client. */
  receive(event: string, data: unknown) {
    this.inbox.push(() => {
      this.fire(event, data);
    });
  }

  fire(event: string, data: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(data as never);
  }
}

export class TestHub {
  building: Building;
  version = 1;
  readonly sockets: FakeSocket[] = [];
  /** Highest applied sequence number per tab. */
  private readonly lastSeq = new Map<string, number>();
  private readonly members = new Set<FakeSocket>();
  /** Batches received and not yet written, in arrival order. */
  private readonly commits: (() => void)[] = [];

  constructor(
    building: Building,
    /** Picks which connection moves next. Seeded in property tests. */
    private readonly random: () => number = Math.random,
  ) {
    this.building = building;
  }

  /** The `connect` option of a SyncClient. */
  readonly connect = (): SocketLike => {
    const socket = new FakeSocket(this);
    this.sockets.push(socket);
    return socket;
  };

  leave(socket: FakeSocket) {
    this.members.delete(socket);
  }

  /** Moves one message: a client's to the server or the server's to a client. False when idle. */
  step(): boolean {
    const ready = this.sockets.flatMap((socket) => [
      ...(socket.online && socket.outbox.length > 0
        ? [
            () => {
              this.process(socket);
            },
          ]
        : []),
      ...(socket.online && socket.inbox.length > 0
        ? [
            () => {
              socket.inbox.shift()?.();
            },
          ]
        : []),
    ]);
    if (this.commits.length > 0) {
      ready.push(() => {
        this.commits.shift()?.();
      });
    }
    if (ready.length === 0) return false;
    ready[Math.floor(this.random() * ready.length)]?.();
    return true;
  }

  /**
   * The server takes in everything that was sent before it writes any batch: the worst
   * case, in which presence overtakes every batch.
   */
  receiveAll() {
    for (const socket of this.sockets) {
      while (socket.online && socket.outbox.length > 0) this.process(socket);
    }
  }

  /** Delivers everything, in a random interleaving. */
  flush() {
    let guard = 0;
    while (this.step()) {
      guard += 1;
      if (guard > 100000) throw new Error("hub does not settle");
    }
  }

  private process(socket: FakeSocket) {
    const message = socket.outbox.shift();
    if (!message) return;
    const reply = (response: unknown) => {
      if (message.ack) {
        const ack = message.ack;
        socket.inbox.push(() => {
          ack(response as never);
        });
      }
    };
    const data = message.data as Record<string, unknown>;
    if (message.event === "join") {
      socket.clientId = data.clientId as string;
      socket.actor = data.actor as string;
      this.members.add(socket);
      reply({
        ok: true,
        version: this.version,
        building: this.building,
        lastSeq: this.lastSeq.get(socket.clientId) ?? 0,
      });
      const actors = [...this.members].map((m) => ({
        clientId: m.clientId,
        actor: m.actor,
        color: "#123456",
        selection: null,
      }));
      for (const member of this.members) member.receive("presence", { actors });
      return;
    }
    if ((message.event === "cursor" || message.event === "drag") && socket.clientId) {
      // Passed on to the others at once, as the server does.
      for (const member of this.members) {
        if (member !== socket)
          member.receive(message.event, { clientId: socket.clientId, ...data });
      }
      return;
    }
    if (message.event !== "ops" || !socket.clientId) return;
    // The server writes a batch to Postgres before it answers, while presence goes out at
    // once: the batch waits here, and other messages may overtake it.
    const clientId = socket.clientId;
    this.commits.push(() => {
      this.commit(clientId, data, reply);
    });
  }

  private commit(
    clientId: string,
    data: Record<string, unknown>,
    reply: (response: unknown) => void,
  ) {
    const seq = data.seq as number;
    const ops = data.ops as Op[];
    if ((this.lastSeq.get(clientId) ?? 0) >= seq) {
      reply({ ok: true, version: this.version, duplicate: true });
      return;
    }
    const { value, dropped } = applyOps(this.building, ops);
    const error =
      checkBuildingShape(value, "building") ??
      (data.valid === false ? null : validateBuilding(value));
    if (error) {
      reply({ ok: false, reason: "invalid", error });
      return;
    }
    this.building = value;
    this.version += 1;
    this.lastSeq.set(clientId, seq);
    const applied = ops.filter((op) => !dropped.includes(op));
    for (const member of this.members) {
      member.receive("ops", {
        version: this.version,
        clientId,
        seq,
        actor: "test",
        ops: applied,
      });
    }
    reply({ ok: true, version: this.version, duplicate: false });
  }
}
