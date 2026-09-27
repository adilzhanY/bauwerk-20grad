import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { parseOps } from "@/sync/ops";
import { ProjectsService } from "./projects.service";
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

@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const project = await this.projects.get(id);
    if (!project) throw new NotFoundException();
    return project;
  }

  @Post()
  async create(@Body() body: unknown, @Headers("x-actor") actor?: string) {
    return unwrap(await this.projects.create(buildingOf(body), actorOf(actor)));
  }

  /** The same as the socket's "ops" message, for clients without a socket. */
  @Post(":id/ops")
  @HttpCode(200)
  async ops(@Param("id") id: string, @Body() body: unknown, @Headers("x-actor") actor?: string) {
    const batch = batchOf(body);
    if (!batch) throw new BadRequestException({ error: "invalidBatch" });
    return batchResponse(await this.projects.applyBatch(id, batch, actorOf(actor)));
  }

  @Get(":id/versions")
  async versions(@Param("id") id: string) {
    const versions = await this.projects.versions(id);
    if (!versions) throw new NotFoundException();
    return versions;
  }

  @Get(":id/versions/:version")
  async version(@Param("id") id: string, @Param("version") raw: string) {
    const version = Number(raw);
    if (!Number.isInteger(version)) throw new NotFoundException();
    const result = await this.projects.buildingAt(id, version);
    if (result.ok) return { version, building: result.building };
    if (result.reason === "notReplayable") throw new HttpException({ error: "notReplayable" }, 409);
    throw new NotFoundException();
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string) {
    if (!(await this.projects.remove(id))) throw new NotFoundException();
  }
}
