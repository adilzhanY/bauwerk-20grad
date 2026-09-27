import { Controller, Get, Inject, Query } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "./auth.guard";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /**
   * Before a sign up: is this username free? Supabase answers a taken one only with a generic
   * database error. It tells anyone whether a username exists, which is fine for usernames.
   */
  @Public()
  @Get("username-available")
  usernameAvailable(@Query("name") name: unknown) {
    return this.auth.usernameAvailable(typeof name === "string" ? name.trim() : "");
  }
}
