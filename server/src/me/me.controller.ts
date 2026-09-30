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
  Put,
  Req,
} from "@nestjs/common";
import type { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { buildingPatchSchema, gidSchema, settingsSchema } from "./me.schema";
import { MeService } from "./me.service";

/** The signed in user's id; with accounts off there is no "me" to keep data for. */
function me(request: AuthedRequest): string {
  if (!request.user) throw new NotFoundException({ error: "off" });
  return request.user.id;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ error: "invalid" });
  return result.data;
}

/** A user's own data: settings, bookmarks, notes and surveys of LoD2 buildings. */
@Controller("me")
export class MeController {
  constructor(@Inject(MeService) private readonly data: MeService) {}

  @Get()
  all(@Req() request: AuthedRequest) {
    return this.data.all(me(request));
  }

  @Put("settings")
  @HttpCode(204)
  async settings(@Req() request: AuthedRequest, @Body() body: unknown) {
    await this.data.saveSettings(me(request), parse(settingsSchema, body));
  }

  @Put("bookmarks/:gid")
  @HttpCode(204)
  async bookmark(@Req() request: AuthedRequest, @Param("gid") gid: string) {
    await this.data.setBookmark(me(request), parse(gidSchema, gid), true);
  }

  @Delete("bookmarks/:gid")
  @HttpCode(204)
  async unbookmark(@Req() request: AuthedRequest, @Param("gid") gid: string) {
    await this.data.setBookmark(me(request), parse(gidSchema, gid), false);
  }

  @Put("buildings/:gid")
  @HttpCode(204)
  async building(@Req() request: AuthedRequest, @Param("gid") gid: string, @Body() body: unknown) {
    await this.data.saveBuilding(
      me(request),
      parse(gidSchema, gid),
      parse(buildingPatchSchema, body),
    );
  }
}
