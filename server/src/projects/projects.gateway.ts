import { Inject } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { actorOf, batchOf } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { AuthService, Unauthenticated } from "../auth/auth.service";
import type { AuthUser } from "../auth/auth.service";
import type { ProjectOps } from "./projects.service";

/** What the server keeps about one connected editor tab. */
interface Member {
  projectId: string;
  clientId: string;
  actor: string;
  color: string;
  selection: unknown;
  /** The signed in user, set by the connection middleware when accounts are on. */
  user?: AuthUser;
}

/** One colour per person on every device, from their user id. The same set as the client's. */
const COLORS = ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#6c8ef5", "#b084cc"];
export function colorFor(userId: string): string {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? "#6c8ef5";
}

/** One entry of the presence list: every tab in the project room. */
export interface PresenceEntry {
  clientId: string;
  actor: string;
  color: string;
  selection: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function isSelection(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "vertex":
      return isIndex(value.index);
    case "wall":
    case "interiorWall":
      return isText(value.storeyId, 128) && isIndex(value.wallIndex ?? value.index);
    case "opening":
    case "room":
    case "radiator":
    case "pipe":
      return isText(value.storeyId, 128) && isText(value.id, 128);
    case "storey":
    case "zone":
    case "heatPump":
      return isText(value.id, 128);
    case "roof":
      return true;
    default:
      return false;
  }
}

const isCoordinate = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e5;
const isPoint = (value: unknown) =>
  isRecord(value) && isCoordinate(value.x) && isCoordinate(value.y);
const isDrag = (value: unknown) =>
  isRecord(value) &&
  isText(value.storeyId, 128) &&
  isText(value.id, 128) &&
  isCoordinate(value.offset);

const room = (projectId: string) => `project:${projectId}`;
const member = (socket: Socket) => socket.data as Partial<Member>;

/**
 * One Socket.IO room per project.
 *
 *   join       { projectId, clientId, actor, color }  ack: the building, its version, and the
 *              last batch of this client the project applied
 *   ops        { seq, ops }                            ack: applied (version) or the reason not
 *   selection  { selection }
 *   cursor     { cursor }     the pointer on the ground, passed on to the others
 *   drag       { dragging }   the opening being dragged, passed on to the others
 *
 * Every applied batch goes to the whole room, the sender included, as "ops" with its
 * version, so all tabs replay the same batches in the same order. Presence goes out on
 * every join, leave and selection change.
 */
@WebSocketGateway({ cors: { origin: true }, maxHttpBufferSize: 5e6 })
export class ProjectsGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer() private readonly server!: Server;

  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private readonly onOps = (event: ProjectOps) => {
    this.server.to(room(event.projectId)).emit("ops", event);
  };

  afterInit(server: Server) {
    // With accounts on, a connection without a valid token is turned away before any message.
    server.use((socket, next) => {
      if (!this.auth.enabled) {
        next();
        return;
      }
      const token = (socket.handshake.auth as { token?: unknown }).token;
      this.auth
        .verify(typeof token === "string" ? token : undefined)
        .then((user) => {
          (socket.data as Partial<Member>).user = user;
          next();
        })
        .catch((error: unknown) => {
          next(error instanceof Unauthenticated ? new Error("signIn") : new Error("authFailed"));
        });
    });
    this.projects.events.on("ops", this.onOps);
  }

  onModuleDestroy() {
    this.projects.events.off("ops", this.onOps);
  }

  @SubscribeMessage("join")
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    if (
      !isRecord(body) ||
      !isText(body.projectId, 128) ||
      !isText(body.clientId, 64) ||
      !isText(body.actor, 64) ||
      typeof body.color !== "string" ||
      !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(body.color)
    ) {
      return { ok: false, reason: "invalid" };
    }
    const previous = member(socket).projectId;
    if (previous && previous !== body.projectId) {
      await socket.leave(room(previous));
      await this.sendPresence(previous);
    }
    // Signed in, the name and colour are the account's, not what the client sent.
    const user = member(socket).user;
    const access = await this.projects.access(body.projectId, user, true);
    if (access !== "ok") return { ok: false, reason: access };
    socket.data = {
      projectId: body.projectId,
      clientId: body.clientId,
      actor: user?.username ?? actorOf(body.actor),
      color: user ? colorFor(user.id) : body.color,
      selection: null,
      ...(user ? { user } : {}),
    } satisfies Member;
    // Join before reading, so no batch can fall between the snapshot and the room. A batch
    // that lands in between arrives twice, as part of the snapshot and as a message, and
    // the client skips the message by its version.
    await socket.join(room(body.projectId));
    const project = await this.projects.get(body.projectId);
    if (!project) return { ok: false, reason: "notFound" };
    const lastSeq = await this.projects.lastSeq(body.projectId, body.clientId);
    await this.sendPresence(body.projectId);
    return { ok: true, version: project.version, building: project.building, lastSeq };
  }

  @SubscribeMessage("ops")
  async ops(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId, actor } = member(socket);
    if (!projectId || !clientId || !actor) return { ok: false, reason: "notJoined" };
    const batch = batchOf(isRecord(body) ? { ...body, clientId } : null);
    if (!batch) return { ok: false, reason: "invalidBatch" };
    const result = await this.projects.applyBatch(projectId, batch, actor, member(socket).user?.id);
    return result.ok
      ? { ok: true, version: result.version, duplicate: result.duplicate }
      : { ok: false, reason: result.reason, ...("error" in result ? { error: result.error } : {}) };
  }

  @SubscribeMessage("selection")
  selection(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const data = member(socket);
    if (!data.projectId || !isRecord(body) || !isSelection(body.selection)) return;
    data.selection = body.selection;
    socket
      .to(room(data.projectId))
      .emit("selection", { clientId: data.clientId, selection: body.selection });
  }

  /** Where the pointer is on the ground. Fire and forget: a lost one is replaced by the next. */
  @SubscribeMessage("cursor")
  cursor(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId } = member(socket);
    if (!projectId || !isRecord(body)) return;
    const cursor = body.cursor;
    if (cursor !== null && !isPoint(cursor)) return;
    socket.volatile.to(room(projectId)).emit("cursor", { clientId, cursor });
  }

  /** The opening being dragged and where it is now, so the others see it move and keep off. */
  @SubscribeMessage("drag")
  drag(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId } = member(socket);
    if (!projectId || !isRecord(body)) return;
    const dragging = body.dragging;
    if (dragging !== null && !isDrag(dragging)) return;
    socket.to(room(projectId)).emit("drag", { clientId, dragging });
  }

  async handleDisconnect(socket: Socket) {
    const { projectId } = member(socket);
    if (projectId) await this.sendPresence(projectId);
  }

  private async sendPresence(projectId: string) {
    const sockets = await this.server.in(room(projectId)).fetchSockets();
    const actors: PresenceEntry[] = sockets.map((s) => {
      const data = s.data as Member;
      return {
        clientId: data.clientId,
        actor: data.actor,
        color: data.color,
        selection: data.selection,
      };
    });
    this.server.to(room(projectId)).emit("presence", { actors });
  }
}
