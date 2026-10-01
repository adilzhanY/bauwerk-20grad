import {
  BadRequestException,
  Body,
  ConflictException,
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
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { granted } from "./projects.controller";
import { MembersService } from "./members.service";
import { ProjectsService } from "./projects.service";

const Uuid = z.uuid();
const Given = z.enum(["editor", "commenter", "viewer"]);
const Invite = z.object({ userId: Uuid, role: Given });
const RoleChange = z.object({ role: z.enum(["owner", "editor", "commenter", "viewer"]) });
const Ask = z.object({ message: z.string().trim().max(500).optional() });
const Decision = z.object({ role: Given.nullable() });

/** A signed in person, or a 401: members exist only with accounts. */
function me(request: AuthedRequest) {
  if (!request.user) throw new UnauthorizedException({ error: "signIn" });
  return request.user;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException({ error: "invalid" });
  return parsed.data;
}

function done(outcome: "ok" | "notFound" | "already" | "owner") {
  if (outcome === "notFound") throw new NotFoundException();
  if (outcome === "already") throw new ConflictException({ error: "already" });
  if (outcome === "owner") throw new ConflictException({ error: "owner" });
}

/**
 * Who has access to a project (TODO Part 21, CB.4, CB.6): everyone with access sees the list;
 * only the owner invites, changes roles, removes and answers requests; anyone but the owner
 * may leave; a signed in person without access may ask for it.
 */
@Controller("projects/:id")
export class MembersController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  @Get("members")
  async list(@Param("id") id: string, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "see"));
    return this.members.list(id);
  }

  @Post("members")
  @HttpCode(204)
  async invite(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, me(request), "manage"));
    const { userId, role } = parse(Invite, body);
    done(await this.members.invite(id, userId, role, me(request).id));
  }

  @Patch("members/:userId")
  @HttpCode(204)
  async setRole(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, me(request), "manage"));
    const target = parse(Uuid, userId);
    const { role } = parse(RoleChange, body);
    done(
      role === "owner"
        ? await this.members.transfer(id, target, me(request).id)
        : await this.members.setRole(id, target, role, me(request).id),
    );
  }

  @Delete("members/:userId")
  @HttpCode(204)
  async remove(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Req() request: AuthedRequest,
  ) {
    const target = parse(Uuid, userId);
    // Leaving needs only access; taking someone else out needs the owner.
    granted(
      await this.projects.access(id, me(request), target === me(request).id ? "see" : "manage"),
    );
    done(await this.members.remove(id, target, me(request).id));
  }

  @Post("access-requests")
  @HttpCode(204)
  async ask(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthedRequest) {
    const { message } = parse(Ask, body ?? {});
    done(
      await this.members.request(
        id,
        me(request).id,
        message === undefined || message === "" ? null : message,
      ),
    );
  }

  @Get("access-requests")
  async requests(@Param("id") id: string, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, me(request), "manage"));
    return this.members.requests(id);
  }

  @Post("access-requests/:userId")
  @HttpCode(204)
  async decide(
    @Param("id") id: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, me(request), "manage"));
    const { role } = parse(Decision, body);
    done(await this.members.decide(id, parse(Uuid, userId), role, me(request).id));
  }
}
