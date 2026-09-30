import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AuthRefused, AuthService } from "./auth.service";
import type { Session } from "./auth.service";
import { Public } from "./auth.guard";
import type { AuthedRequest } from "./auth.guard";

/** The HTTP status for each refusal; the body names the reason and, if any, the field. */
const STATUS: Record<AuthRefused["reason"], number> = {
  invalid: 400,
  usernameTaken: 409,
  credentials: 401,
  tooMany: 429,
  off: 404,
};

async function answer(work: Promise<Session>): Promise<Session> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof AuthRefused) {
      throw new HttpException({ error: error.reason, fields: error.fields }, STATUS[error.reason]);
    }
    throw error;
  }
}

/** The address a request came from; behind the proxy, the one it names (app.ts trusts it). */
const addressOf = (request: AuthedRequest) => request.ip ?? "unknown";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Whether this server has accounts at all, so the app knows whether to offer signing in. */
  @Public()
  @Get("mode")
  mode() {
    return { accounts: this.auth.enabled };
  }

  /** A new account: first and last name, username, password twice. Signs in at once. */
  @Public()
  @Post("sign-up")
  signUp(@Body() body: unknown, @Req() request: AuthedRequest) {
    return answer(this.auth.signUp(body, addressOf(request)));
  }

  @Public()
  @Post("sign-in")
  @HttpCode(200)
  signIn(@Body() body: unknown, @Req() request: AuthedRequest) {
    return answer(this.auth.signIn(body, addressOf(request)));
  }

  /** The signed in account, for a page that opens with a token it kept. */
  @Get("me")
  me(@Req() request: AuthedRequest) {
    if (!request.user) throw new HttpException({ error: "off" }, 404);
    return request.user;
  }

  /** Before a sign up: is this username free? Says only that, which is fine for usernames. */
  @Public()
  @Get("username-available")
  usernameAvailable(@Query("name") name: unknown) {
    return this.auth.usernameAvailable(typeof name === "string" ? name.trim() : "");
  }
}
