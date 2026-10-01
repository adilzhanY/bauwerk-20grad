import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../auth/auth.guard";
import { NotificationsService } from "./notifications.service";

const Read = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }),
]);

/** The signed in person's own inbox (TODO Part 21, CF.3). */
@Controller("notifications")
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  inbox(@Req() request: AuthedRequest) {
    if (!request.user) throw new UnauthorizedException({ error: "signIn" });
    return this.notifications.inbox(request.user.id);
  }

  @Post("read")
  @HttpCode(204)
  async read(@Body() body: unknown, @Req() request: AuthedRequest) {
    if (!request.user) throw new UnauthorizedException({ error: "signIn" });
    const parsed = Read.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "invalid" });
    await this.notifications.markRead(
      request.user.id,
      "all" in parsed.data ? "all" : parsed.data.ids,
    );
  }
}
