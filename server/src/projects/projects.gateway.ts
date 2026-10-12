import { Inject, Logger } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from "@nestjs/websockets";
import { NotificationsService } from "../notifications/notifications.service";
import type { Notice } from "../notifications/notifications.service";
import { MembersService } from "./members.service";
import { LiveProjects } from "./live.service";
import { ThreadsService } from "../threads/threads.service";
import { FilesService } from "../files/files.service";
import type { Server, Socket } from "socket.io";
import { actorOf, batchOf } from "./projects.controller";
import { colorFor } from "@/sync/colors";
import { ProjectsService } from "./projects.service";
import { AuthService, Unauthenticated, displayName } from "../auth/auth.service";
import { can } from "@/projects/roles";
import type { Role } from "@/projects/roles";
import type { AuthUser } from "../auth/auth.service";
import type { ProjectOps } from "./projects.service";

/** What the server keeps about one connected editor tab. */
interface Member {
  projectId: string;
  clientId: string;
  actor: string;
  color: string;
  selection: unknown;
  /** The person's role in the project, checked on join; only editors and owners send ops. */
  role: Role;
  /** Here, or away (the tab hidden for a while), and where in the project. */
  state: "here" | "away";
  page: string | null;
  storeyId: string | null;
  /** The signed in user, set by the connection middleware when accounts are on. */
  user?: AuthUser;
}

/**
 * One entry of the presence list: every tab in the project room. The editor groups the tabs
 * of one person (`userId`) into one avatar; cursors and selections stay per tab.
 */
export interface PresenceEntry {
  clientId: string;
  actor: string;
  color: string;
  selection: unknown;
  userId: string | null;
  firstName: string | null;
  lastName: string | null;
  state: "here" | "away";
  page: string | null;
  storeyId: string | null;
}

const PAGES = new Set(["building", "editor", "variants", "report"]);
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e5;
const isVec3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(isNumber);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const isIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/*
 * What a tab sends is checked and then rebuilt from the checked fields only, so nothing else it
 * adds (a few megabytes of padding) is stored or passed on. Each returns undefined when invalid.
 */

/** An activity a tab may announce: what kind and where, nothing more. */
function activityOf(value: unknown) {
  if (!isRecord(value)) return undefined;
  const { kind, storeyId, wallIndex, count, version } = value;
  switch (kind) {
    case "floorPlan":
      return isText(storeyId, 128) ? { kind, storeyId } : undefined;
    case "facade":
      return isIndex(wallIndex) && typeof count === "number" && count >= 0
        ? { kind, wallIndex, count }
        : undefined;
    case "restore":
      return typeof version === "number" && Number.isInteger(version)
        ? { kind, version }
        : undefined;
    default:
      return undefined;
  }
}

function selectionOf(value: unknown) {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { kind, storeyId, id, index, wallIndex } = value;
  switch (kind) {
    case "vertex":
      return isIndex(index) ? { kind, index } : undefined;
    case "wall":
      return isText(storeyId, 128) && isIndex(wallIndex)
        ? { kind, storeyId, wallIndex }
        : undefined;
    case "interiorWall":
      return isText(storeyId, 128) && isIndex(index) ? { kind, storeyId, index } : undefined;
    case "opening":
    case "room":
    case "radiator":
    case "pipe":
      return isText(storeyId, 128) && isText(id, 128) ? { kind, storeyId, id } : undefined;
    case "storey":
    case "zone":
    case "heatPump":
      return isText(id, 128) ? { kind, id } : undefined;
    case "roof":
      return { kind };
    default:
      return undefined;
  }
}

const pointOf = (value: unknown) =>
  value === null
    ? null
    : isRecord(value) && isNumber(value.x) && isNumber(value.y)
      ? { x: value.x, y: value.y }
      : undefined;
const dragOf = (value: unknown) =>
  value === null
    ? null
    : isRecord(value) &&
        isText(value.storeyId, 128) &&
        isText(value.id, 128) &&
        isNumber(value.offset)
      ? { storeyId: value.storeyId, id: value.id, offset: value.offset }
      : undefined;

const room = (projectId: string) => `project:${projectId}`;
const userRoom = (userId: string) => `user:${userId}`;
const member = (socket: Socket) => socket.data as Partial<Member>;

/**
 * One Socket.IO room per project.
 *
 *   join       { projectId, clientId, actor, color, link? }  ack: the building, its version,
 *              the person's role and the last batch of this client the project applied; `link`
 *              is the share link's token for someone who is not a member yet
 *   ops        { seq, ops }    editors and owners only; ack: applied (version) or the reason not
 *   selection  { selection }
 *   cursor     { cursor }     the pointer on the ground, passed on to the others
 *   drag       { dragging }   the opening being dragged, passed on to the others
 *
 * Every applied batch goes to the whole room, the sender included, as "ops" with its
 * version, so all tabs replay the same batches in the same order. Presence goes out on
 * every join, leave and selection change.
 */
// A closed or frozen tab is noticed within 30 s: a ping every 10 s, 20 s to answer.
@WebSocketGateway({
  cors: { origin: true },
  maxHttpBufferSize: 5e6,
  pingInterval: 10_000,
  pingTimeout: 20_000,
})
export class ProjectsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() private readonly server!: Server;

  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(LiveProjects) private readonly live: LiveProjects,
    @Inject(ThreadsService) private readonly threads: ThreadsService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  /** A file was added, replaced or removed: every tab in the project reloads its pictures. */
  private readonly onFiles = (projectId: string) => {
    this.server.to(room(projectId)).emit("files", { projectId });
  };

  /** Threads changed: every tab in the project reloads them. */
  private readonly onThreads = (projectId: string) => {
    this.server.to(room(projectId)).emit("threads", { projectId });
  };

  private readonly log = new Logger("collab");

  private readonly onOps = (event: ProjectOps) => {
    this.server.to(room(event.projectId)).emit("ops", event);
  };

  /** A new inbox item goes to every tab of its person, wherever on the site they are. */
  private readonly onNotification = (userId: string, notice: Notice) => {
    this.server.to(userRoom(userId)).emit("notification", notice);
  };

  /**
   * A role changed or was taken away: the person's tabs in that project learn it at once
   * ("access" with the new role or null), and a removed person's tabs leave the room.
   */
  private readonly onAccess = (projectId: string, userId: string, role: Role | null) => {
    void this.server
      .in(room(projectId))
      .fetchSockets()
      .then(async (sockets) => {
        for (const socket of sockets) {
          const data = socket.data as Partial<Member>;
          if (data.user?.id !== userId) continue;
          socket.emit("access", { projectId, role });
          if (role) data.role = role;
          else {
            socket.leave(room(projectId));
            data.projectId = undefined;
            this.live.remove(projectId, socket.id);
          }
        }
        if (!role) await this.sendPresence(projectId);
      })
      .catch((error: unknown) => {
        this.log.error(`access change for ${projectId} not delivered: ${String(error)}`);
      });
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
    this.notifications.events.on("notification", this.onNotification);
    this.members.events.on("access", this.onAccess);
    this.threads.events.on("changed", this.onThreads);
    this.files.events.on("changed", this.onFiles);
  }

  /** Every tab of a signed in person is in their own room, for notifications. */
  async handleConnection(socket: Socket) {
    const user = (socket.data as Partial<Member>).user;
    if (user) await socket.join(userRoom(user.id));
  }

  onModuleDestroy() {
    this.projects.events.off("ops", this.onOps);
    this.notifications.events.off("notification", this.onNotification);
    this.members.events.off("access", this.onAccess);
    this.threads.events.off("changed", this.onThreads);
    this.files.events.off("changed", this.onFiles);
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
    // Signed in, the name and colour are the account's, not what the client sent.
    const user = member(socket).user;
    const previous = member(socket).projectId;
    if (previous && previous !== body.projectId) {
      await socket.leave(room(previous));
      await this.left(socket, previous);
      // Out of the room, it hears no more of that project (not even its removal), so it
      // keeps nothing of it either: a refused join below must not leave the old role behind.
      socket.data = user ? { user } : {};
    }
    const link = typeof body.link === "string" ? body.link : undefined;
    const access = await this.projects.roleIn(body.projectId, user, link);
    if (!access.ok) return { ok: false, reason: access.reason };
    socket.data = {
      projectId: body.projectId,
      clientId: body.clientId,
      actor: user ? displayName(user) : actorOf(body.actor),
      color: user ? colorFor(user.id) : body.color,
      selection: null,
      role: access.role,
      state: "here",
      page: typeof body.page === "string" && PAGES.has(body.page) ? body.page : null,
      storeyId: isText(body.storeyId, 128) ? body.storeyId : null,
      ...(user ? { user } : {}),
    } satisfies Member;
    this.track(socket);
    // Join before reading, so no batch can fall between the snapshot and the room. A batch
    // that lands in between arrives twice, as part of the snapshot and as a message, and
    // the client skips the message by its version.
    await socket.join(room(body.projectId));
    const project = await this.projects.get(body.projectId);
    if (!project) return { ok: false, reason: "notFound" };
    const lastSeq = await this.projects.lastSeq(body.projectId, body.clientId);
    // For "since your last visit": when this person was last in it, before this visit.
    const lastSeenAt = user ? await this.members.lastSeen(body.projectId, user.id) : null;
    await this.sendPresence(body.projectId);
    return {
      ok: true,
      version: project.version,
      building: project.building,
      lastSeq,
      role: access.role,
      lastSeenAt,
    };
  }

  /** The last batch of each tab still in progress, so the next one waits for it. */
  private readonly batches = new WeakMap<Socket, Promise<unknown>>();

  /**
   * Nest handles one socket's messages concurrently and the client does not wait for an ack
   * before its next batch, so each tab's batches are applied strictly in the order sent.
   */
  @SubscribeMessage("ops")
  ops(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const result = (this.batches.get(socket) ?? Promise.resolve()).then(() =>
      this.applyOps(socket, body),
    );
    this.batches.set(
      socket,
      result.catch(() => undefined),
    );
    return result;
  }

  private async applyOps(socket: Socket, body: unknown) {
    const { projectId, clientId, actor } = member(socket);
    if (!projectId || !clientId || !actor) return { ok: false, reason: "notJoined" };
    if (!can(member(socket).role, "edit")) return { ok: false, reason: "notAllowed" };
    const batch = batchOf(isRecord(body) ? { ...body, clientId } : null);
    if (!batch) return { ok: false, reason: "invalidBatch" };
    // The role on the socket is what it was at the join; every change asks the database
    // again, so a removal or a downgrade holds even for a tab that missed its message.
    const user = member(socket).user;
    if (user) {
      const now = await this.projects.roleIn(projectId, user);
      if (!now.ok || !can(now.role, "edit")) return { ok: false, reason: "notAllowed" };
    }
    const result = await this.projects.applyBatch(projectId, batch, actor, member(socket).user?.id);
    return result.ok
      ? { ok: true, version: result.version, duplicate: result.duplicate }
      : { ok: false, reason: result.reason, ...("error" in result ? { error: result.error } : {}) };
  }

  @SubscribeMessage("selection")
  selection(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const data = member(socket);
    const selection = isRecord(body) ? selectionOf(body.selection) : undefined;
    if (!data.projectId || selection === undefined) return;
    data.selection = selection;
    socket.to(room(data.projectId)).emit("selection", { clientId: data.clientId, selection });
  }

  /** Where the pointer is on the ground. Fire and forget: a lost one is replaced by the next. */
  @SubscribeMessage("cursor")
  cursor(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId } = member(socket);
    const cursor = isRecord(body) ? pointOf(body.cursor) : undefined;
    if (!projectId || cursor === undefined) return;
    socket.volatile.to(room(projectId)).emit("cursor", { clientId, cursor });
  }

  /**
   * The opening being dragged and where it is now, so the others see it move and keep off.
   * Editors only: the others' editors disable an opening someone drags.
   */
  @SubscribeMessage("drag")
  drag(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId, role } = member(socket);
    if (!can(role, "edit")) return;
    const dragging = isRecord(body) ? dragOf(body.dragging) : undefined;
    if (!projectId || dragging === undefined) return;
    socket.to(room(projectId)).emit("drag", { clientId, dragging });
  }

  /**
   * Here or away, and where in the project: page and storey. Sent on joining and whenever one
   * of them changes; others see it in the avatars, and the Projects page sees who is in it.
   */
  @SubscribeMessage("status")
  async status(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const data = member(socket);
    if (!data.projectId || !isRecord(body)) return;
    if (body.state !== "here" && body.state !== "away") return;
    data.state = body.state;
    data.page = typeof body.page === "string" && PAGES.has(body.page) ? body.page : null;
    data.storeyId = isText(body.storeyId, 128) ? body.storeyId : null;
    this.track(socket);
    await this.sendPresence(data.projectId);
  }

  /**
   * Something big this tab did (a floor plan applied, a facade's openings put on, a version
   * restored), for a short toast on the others' screens. Only relayed, never stored: the
   * change itself travels as ops; this only says who did it, so only editors may say it.
   */
  @SubscribeMessage("activity")
  activity(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId, actor, user, role } = member(socket);
    if (!can(role, "edit")) return;
    const activity = isRecord(body) ? activityOf(body.activity) : undefined;
    if (!projectId || !activity) return;
    socket
      .to(room(projectId))
      .emit("activity", { clientId, actor, userId: user?.id ?? null, activity });
  }

  /**
   * Where this tab's camera is, for whoever follows it (TODO Part 21, CC.5). Fire and forget,
   * like the pointer: a lost one is replaced by the next.
   */
  @SubscribeMessage("view")
  view(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const { projectId, clientId } = member(socket);
    if (!projectId || !isRecord(body) || !isVec3(body.position) || !isVec3(body.target)) return;
    const storeyId = isText(body.storeyId, 128) ? body.storeyId : null;
    // Plan or 3D, and the plan's zoom: a follower mirrors the view, not only the camera.
    const plan = body.plan === true;
    const zoom = isNumber(body.zoom) && body.zoom > 0 ? body.zoom : null;
    socket.volatile.to(room(projectId)).emit("view", {
      clientId,
      position: body.position,
      target: body.target,
      storeyId,
      plan,
      zoom,
    });
  }

  async handleDisconnect(socket: Socket) {
    const { projectId } = member(socket);
    // Nest does not wait for this; a failed write of "last seen" must not go unhandled.
    if (projectId)
      await this.left(socket, projectId).catch((error: unknown) => {
        this.log.error(`leaving ${projectId}: ${String(error)}`);
      });
  }

  /** Keeps the live list of the Projects page in step with this tab. */
  private track(socket: Socket) {
    const data = member(socket);
    if (!data.projectId || !data.user) return;
    this.live.set(data.projectId, socket.id, {
      userId: data.user.id,
      firstName: data.user.firstName,
      lastName: data.user.lastName,
      state: data.state ?? "here",
    });
  }

  /** A tab left a project: when it was the person's last one there, note when they were in it. */
  private async left(socket: Socket, projectId: string) {
    this.live.remove(projectId, socket.id);
    const user = member(socket).user;
    if (user && !this.live.stillIn(projectId, user.id)) {
      await this.members.markSeen(projectId, user.id);
    }
    await this.sendPresence(projectId);
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
        userId: data.user?.id ?? null,
        firstName: data.user?.firstName ?? null,
        lastName: data.user?.lastName ?? null,
        state: data.state,
        page: data.page,
        storeyId: data.storeyId,
      };
    });
    this.server.to(room(projectId)).emit("presence", { actors });
  }
}
