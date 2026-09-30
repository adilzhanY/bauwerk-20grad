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
import { parseOps } from "@/sync/ops";
import type { AuthedRequest } from "../auth/auth.guard";
import { displayName } from "../auth/auth.service";
import type { AuthUser } from "../auth/auth.service";
import { PHOTO_SLOT, ProjectsService } from "./projects.service";
import type { BatchResult, WriteResult } from "./projects.service";

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
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  /** Throws 404 or 403 unless this request may use the project. */
  private async allow(id: string, request: AuthedRequest, join = false) {
    const access = await this.projects.access(id, userOf(request), join);
    if (access === "notFound") throw new NotFoundException();
    if (access === "forbidden") throw new ForbiddenException({ error: "notMember" });
  }

  @Get()
  list(@Req() request: AuthedRequest) {
    return this.projects.list(userOf(request));
  }

  @Get(":id")
  async get(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request);
    const project = await this.projects.get(id);
    if (!project) throw new NotFoundException();
    return project;
  }

  /** Opening a shared link: the signed in user becomes a member, then reads the project. */
  @Post(":id/join")
  @HttpCode(200)
  async join(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request, true);
    return { ok: true };
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
    await this.allow(id, request);
    return batchResponse(
      await this.projects.applyBatch(id, batch, nameOf(request, actor), request.user?.id),
    );
  }

  @Get(":id/versions")
  async versions(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request);
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
    await this.allow(id, request);
    const version = Number(raw);
    if (!Number.isInteger(version)) throw new NotFoundException();
    const result = await this.projects.buildingAt(id, version);
    if (result.ok) return { version, building: result.building };
    if (result.reason === "notReplayable") throw new HttpException({ error: "notReplayable" }, 409);
    throw new NotFoundException();
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Req() request: AuthedRequest) {
    const result = await this.projects.remove(id, userOf(request));
    if (result === "notFound") throw new NotFoundException();
    if (result === "forbidden") throw new ForbiddenException({ error: "notOwner" });
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
    await this.allow(id, request);
    if (!(await this.projects.putPhoto(id, { slot, mime, width: w, height: h, data })))
      throw new NotFoundException();
  }

  @Get(":id/photos")
  async photos(@Param("id") id: string, @Req() request: AuthedRequest) {
    await this.allow(id, request);
    return this.projects.listPhotos(id);
  }

  @Get(":id/photos/:slot")
  async photo(
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Req() request: AuthedRequest,
    @Res() response: Response,
  ) {
    await this.allow(id, request);
    const photo = PHOTO_SLOT.test(slot) ? await this.projects.getPhoto(id, slot) : null;
    if (!photo) throw new NotFoundException();
    response.type(photo.mime).send(photo.data);
  }

  @Delete(":id/photos/:slot")
  @HttpCode(204)
  async removePhoto(
    @Param("id") id: string,
    @Param("slot") slot: string,
    @Req() request: AuthedRequest,
  ) {
    await this.allow(id, request);
    if (PHOTO_SLOT.test(slot)) await this.projects.removePhoto(id, slot);
  }
}
