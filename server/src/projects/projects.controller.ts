import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { LINK_ROLES } from "@/projects/roles";
import { parseOps } from "@/sync/ops";
import type { AuthedRequest } from "../auth/auth.guard";
import { displayName } from "../auth/auth.service";
import type { AuthUser } from "../auth/auth.service";
import { LiveProjects } from "./live.service";
import { send } from "../files/files.controller";
import { FILE_TYPES, FilesService } from "../files/files.service";
import { MAX_FILE_BYTES } from "../files/store";
import { PHOTO_SLOT, ProjectsService } from "./projects.service";
import type { Access, BatchResult, WriteResult } from "./projects.service";
import type { ProjectAction } from "@/projects/roles";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function buildingOf(body: unknown): unknown {
  if (!isRecord(body) || !("building" in body)) {
    throw new BadRequestException({ error: "buildingRequired" });
  }
  return body.building;
}

function unwrap(result: WriteResult) {
  if (result.ok) return result.project;
  throw new HttpException({ error: "invalid", detail: result.error }, 422);
}

/** A batch from the request body, or a 400. The same checks as the socket. */
export function batchOf(body: unknown) {
  const clientId = isRecord(body) ? body.clientId : undefined;
  const seq = isRecord(body) ? body.seq : undefined;
  const ops = parseOps(isRecord(body) ? body.ops : undefined);
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 64) return null;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1 || !ops) return null;
  // Strict unless the sender says its own result was already invalid.
  const valid = !(isRecord(body) && body.valid === false);
  return { clientId, seq, ops, valid };
}

/** What the owner may set on the share link. A date in the past is refused, not stored. */
const LinkSettings = z.object({
  role: z.enum(LINK_ROLES),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  reset: z.boolean().optional(),
});

/** The role from an access check, or the 404 or 403 that says why not. */
export function granted(access: Access) {
  if (access.ok) return access.role;
  if (access.reason === "notFound") throw new NotFoundException();
  throw new ForbiddenException({ error: access.reason });
}

export function batchResponse(result: BatchResult) {
  if (result.ok) return result;
  if (result.reason === "notFound") throw new NotFoundException();
  throw new HttpException({ error: "invalid", detail: result.error }, 422);
}

export const actorOf = (header: unknown) =>
  typeof header === "string" && header.trim() !== "" ? header.trim().slice(0, 64) : "anonymous";

/** The user of a request (with accounts on), or undefined (accounts off). */
const userOf = (request: AuthedRequest): AuthUser | undefined => request.user;

/** The name recorded for a write: the full name when signed in, else the client's header. */
const nameOf = (request: AuthedRequest, header: string | undefined) =>
  request.user ? displayName(request.user) : actorOf(header);

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(LiveProjects) private readonly live: LiveProjects,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  /** The person's role, or a 404 (no such project) or 403 (`notMember`, `notAllowed`). */
  private async allow(id: string, request: AuthedRequest, action: ProjectAction) {
    return granted(await this.projects.access(id, userOf(request), action));
  }

  @Get()
  async list(@Req() request: AuthedRequest) {
    const me = userOf(request)?.id;
    const projects = await this.projects.list(userOf(request));
    // Who has each project open right now, oneself left out.
    return projects.map((p) => ({
      ...p,
      here: this.live.here(p.id).filter((person) => person.userId !== me),
    }));
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() request: AuthedRequest) {
    const role = await this.allow(id, request, "see");
    const project = await this.projects.get(id);
    if (!project) throw new NotFoundException();
    return { ...project, role };
  }

  /**
   * Opening a project, with the share link's token when there is one: a member gets their
   * role; someone else becomes a member with the link's role, or gets a 403 `notMember`.
   */
  @Post(":id/join")
  @HttpCode(200)
  async join(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const link = isRecord(body) && typeof body.link === "string" ? body.link : undefined;
    return { ok: true, role: granted(await this.projects.roleIn(id, userOf(request), link)) };
  }

  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: AuthedRequest,
    @Headers("x-actor") actor?: string,
  ) {
    return unwrap(
      await this.projects.create(buildingOf(body), nameOf(request, actor), request.user?.id),
    );
  }

  /** The same as the socket's "ops" message, for clients without a socket. */
  @Post(":id/ops")
  @HttpCode(200)
  async ops(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
    @Headers("x-actor") actor?: string,
  ) {
    const batch = batchOf(body);
    if (!batch) throw new BadRequestException({ error: "invalidBatch" });
    await this.allow(id, request, "edit");
    return batchResponse(
      await this.projects.applyBatch(id, batch, nameOf(request, actor), request.user?.id),
    );
  }

  @Get(":id/versions")
  async versions(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request, "see");
    const versions = await this.projects.versions(id);
    if (!versions) throw new NotFoundException();
    return versions;
  }

  @Get(":id/versions/:version")
  async version(
    @Param("id") id: string,
    @Param("version") raw: string,
    @Req() request: AuthedRequest,
  ) {
    await this.allow(id, request, "see");
    const version = Number(raw);
    if (!Number.isInteger(version)) throw new NotFoundException();
    const result = await this.projects.buildingAt(id, version);
    if (result.ok) return { version, building: result.building };
    if (result.reason === "notReplayable") throw new HttpException({ error: "notReplayable" }, 409);
    throw new NotFoundException();
  }

  /** The share link, owner only: null when it is off. */
  @Get(":id/link")
  async getLink(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request, "manage");
    return { link: await this.projects.link(id) };
  }

  @Put(":id/link")
  async setLink(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    await this.allow(id, request, "manage");
    const parsed = LinkSettings.safeParse(body);
    const expiresAt =
      parsed.success && parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (!parsed.success || (expiresAt && expiresAt.getTime() <= Date.now())) {
      throw new BadRequestException({ error: "invalidLink" });
    }
    const link = await this.projects.setLink(
      id,
      { role: parsed.data.role, expiresAt, reset: parsed.data.reset ?? false },
      request.user?.id,
    );
    return { link };
  }

  @Delete(":id/link")
  @HttpCode(204)
  async removeLink(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request, "manage");
    await this.projects.removeLink(id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() request: AuthedRequest) {
    // The project goes first, its file rows with it; then the bytes leave the storage.
    const keys = (await this.projects.access(id, userOf(request), "manage")).ok
      ? await this.files.keysOf(id)
      : [];
    const result = await this.projects.remove(id, userOf(request));
    if (result === "notFound") throw new NotFoundException();
    if (result === "forbidden") throw new ForbiddenException({ error: "notOwner" });
    await this.files.removeBytes(keys);
  }

  /** A picture as the raw image body, its size in the X-Width and X-Height headers. */
  @Put(":id/photos/:slot")
  @HttpCode(204)
  async putPhoto(
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Req() request: AuthedRequest,
    @Headers("content-type") mime?: string,
    @Headers("x-width") width?: string,
    @Headers("x-height") height?: string,
  ) {
    const data: unknown = request.body;
    const w = Number(width);
    const h = Number(height);
    if (
      !PHOTO_SLOT.test(slot) ||
      !mime?.startsWith("image/") ||
      !Buffer.isBuffer(data) ||
      data.length === 0 ||
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w <= 0 ||
      h <= 0
    ) {
      throw new BadRequestException({ error: "invalidPhoto" });
    }
    await this.allow(id, request, "edit");
    const type = mime.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!(FILE_TYPES as readonly string[]).includes(type) || data.length > MAX_FILE_BYTES) {
      throw new BadRequestException({ error: "invalidPhoto" });
    }
    await this.files.add(
      id,
      {
        name: `${slot}.${type.split("/")[1] ?? "jpg"}`,
        mime: type,
        data,
        slot,
        width: w,
        height: h,
      },
      request.user?.id,
    );
  }

  @Get(":id/photos")
  async photos(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request, "see");
    // The pictures in slots, as the photo sync knows them.
    return (await this.files.list(id))
      .flatMap((f) =>
        f.slot && PHOTO_SLOT.test(f.slot) && f.width && f.height
          ? [{ slot: f.slot, width: f.width, height: f.height, updatedAt: f.createdAt }]
          : [],
      )
      .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  }

  @Get(":id/photos/:slot")
  async photo(
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Req() request: AuthedRequest,
    @Res() response: Response,
  ) {
    await this.allow(id, request, "see");
    const photo = PHOTO_SLOT.test(slot) ? await this.files.read(id, "slot", slot) : null;
    if (!photo) throw new NotFoundException();
    send(response, photo.record.mime, photo.record.name, photo.data);
  }

  @Delete(":id/photos/:slot")
  @HttpCode(204)
  async removePhoto(
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Req() request: AuthedRequest,
  ) {
    await this.allow(id, request, "edit");
    if (PHOTO_SLOT.test(slot)) await this.files.remove(id, "slot", slot);
  }
}
