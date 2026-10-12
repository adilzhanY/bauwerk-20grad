import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { DB } from "../db";
import { NotificationsService } from "../notifications/notifications.service";
import { granted } from "./projects.controller";
import { ProjectsService } from "./projects.service";

const Name = z.string().trim().min(1).max(80);
const Create = z.object({ name: Name, version: z.number().int().positive().optional() });
const Rename = z.object({ name: Name });

/** A milestone of the project, as the History tab lists it. */
export interface NamedVersion {
  id: string;
  version: number;
  name: string;
  namedBy: { id: string; firstName: string; lastName: string } | null;
  createdAt: string;
}

/**
 * Named versions (TODO Part 21, CG.2): everyone with access lists them; editors name, rename
 * and unname them. Naming one tells the other members quietly (in their inbox, no badge).
 */
@Controller("projects/:id/named")
export class VersionsController {
  constructor(
    @Inject(DB) private readonly pool: Pool,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Param("id") id: string, @Req() request: AuthedRequest): Promise<NamedVersion[]> {
    granted(await this.projects.access(id, request.user, "see"));
    const res = await this.pool.query<{
      id: string;
      version: number;
      name: string;
      named_by: string | null;
      first_name: string | null;
      last_name: string | null;
      created_at: Date;
    }>(
      `SELECT v.id, v.version, v.name, v.named_by, u.first_name, u.last_name, v.created_at
       FROM app.project_versions v LEFT JOIN app.users u ON u.id = v.named_by
       WHERE v.project_id = $1 ORDER BY v.version DESC, v.created_at DESC`,
      [id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      version: r.version,
      name: r.name,
      namedBy:
        r.named_by && r.first_name !== null
          ? { id: r.named_by, firstName: r.first_name, lastName: r.last_name ?? "" }
          : null,
      createdAt: r.created_at.toISOString(),
    }));
  }

  @Post()
  async create(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "edit"));
    const parsed = Create.safeParse(body);
    const project = await this.projects.get(id);
    if (!project) throw new NotFoundException();
    const version = parsed.success ? (parsed.data.version ?? project.version) : 0;
    if (!parsed.success || version > project.version) {
      throw new BadRequestException({ error: "invalid" });
    }
    const named = randomUUID();
    await this.pool.query(
      `INSERT INTO app.project_versions (id, project_id, version, name, named_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [named, id, version, parsed.data.name, request.user?.id ?? null],
    );
    if (request.user) {
      await this.notifications.notifyMembers({
        projectId: id,
        kind: "versionNamed",
        actorId: request.user.id,
        payload: { name: parsed.data.name, version },
        quiet: true,
      });
    }
    return { id: named, version };
  }

  @Patch(":vid")
  @HttpCode(204)
  async rename(
    @Param("id") id: string,
    @Param("vid") vid: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, request.user, "edit"));
    const parsed = Rename.safeParse(body);
    const target = z.uuid().safeParse(vid);
    if (!parsed.success || !target.success) throw new BadRequestException({ error: "invalid" });
    const res = await this.pool.query(
      "UPDATE app.project_versions SET name = $3 WHERE id = $1 AND project_id = $2",
      [target.data, id, parsed.data.name],
    );
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException();
  }

  @Delete(":vid")
  @HttpCode(204)
  async remove(@Param("id") id: string, @Param("vid") vid: string, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "edit"));
    const target = z.uuid().safeParse(vid);
    if (!target.success) throw new NotFoundException();
    const res = await this.pool.query(
      "DELETE FROM app.project_versions WHERE id = $1 AND project_id = $2",
      [target.data, id],
    );
    if ((res.rowCount ?? 0) === 0) throw new NotFoundException();
  }
}
