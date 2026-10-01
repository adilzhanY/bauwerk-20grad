import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import { can } from "@/projects/roles";
import type { AuthedRequest } from "../auth/auth.guard";
import { displayName } from "../auth/auth.service";
import { actorOf, granted } from "../projects/projects.controller";
import { ProjectsService } from "../projects/projects.service";
import { Target, ThreadsService } from "./threads.service";
import type { Author } from "./threads.service";

const Text = z.string().trim().min(1).max(5000);
const Files = z.array(z.uuid()).max(10).optional();
const NewThread = z.object({ target: Target, text: Text, attachments: Files });
const Reply = z.object({ text: Text, attachments: Files });
const Resolve = z.object({ resolved: z.boolean() });
const Edit = z.object({ text: Text });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException({ error: "invalid" });
  return parsed.data;
}

function done(outcome: "ok" | "notFound" | "forbidden" | "invalid") {
  if (outcome === "notFound") throw new NotFoundException();
  if (outcome === "forbidden") throw new ForbiddenException({ error: "notAllowed" });
  if (outcome === "invalid") throw new BadRequestException({ error: "invalid" });
}

/**
 * Threads of a project (TODO Part 21, CE): everyone with access reads them; commenters and up
 * start threads, reply and resolve; a comment is edited by its author and deleted by its
 * author or the owner.
 */
@Controller("projects/:id/threads")
export class ThreadsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ThreadsService) private readonly threads: ThreadsService,
  ) {}

  private author(request: AuthedRequest, header: unknown): Author {
    return request.user
      ? { id: request.user.id, name: displayName(request.user) }
      : { name: actorOf(header) };
  }

  @Get()
  async list(@Param("id") id: string, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "see"));
    return this.threads.list(id);
  }

  @Post()
  async start(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "comment"));
    const { target, text, attachments } = parse(NewThread, body);
    const result = await this.threads.create(
      id,
      target,
      text,
      attachments ?? [],
      this.author(request, request.headers["x-actor"]),
    );
    done(result.outcome);
    return { id: result.threadId };
  }

  @Post(":threadId/comments")
  @HttpCode(204)
  async reply(
    @Param("id") id: string,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, request.user, "comment"));
    const { text, attachments } = parse(Reply, body);
    done(
      await this.threads.reply(
        id,
        parse(z.uuid(), threadId),
        text,
        attachments ?? [],
        this.author(request, request.headers["x-actor"]),
      ),
    );
  }

  @Patch(":threadId")
  @HttpCode(204)
  async resolve(
    @Param("id") id: string,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, request.user, "comment"));
    const { resolved } = parse(Resolve, body);
    done(await this.threads.resolve(id, parse(z.uuid(), threadId), resolved, request.user?.id));
  }

  @Patch("comments/:commentId")
  @HttpCode(204)
  async edit(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, request.user, "comment"));
    if (!request.user) throw new ForbiddenException({ error: "notAllowed" });
    const { text } = parse(Edit, body);
    done(await this.threads.edit(id, parse(z.uuid(), commentId), text, request.user.id));
  }

  @Delete("comments/:commentId")
  @HttpCode(204)
  async remove(
    @Param("id") id: string,
    @Param("commentId") commentId: string,
    @Req() request: AuthedRequest,
  ) {
    const role = granted(await this.projects.access(id, request.user, "comment"));
    done(
      await this.threads.remove(
        id,
        parse(z.uuid(), commentId),
        request.user?.id,
        can(role, "manage"),
      ),
    );
  }
}
