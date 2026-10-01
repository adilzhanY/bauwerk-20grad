import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Pool } from "pg";
import type { AuthedRequest } from "../auth/auth.guard";
import { Limiter } from "../auth/limiter";
import { DB } from "../db";

/** A person as search shows them: never more than their names. */
export interface FoundUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
}

/** Searches per person per minute; enough for typing, not for listing every account. */
const searches = new Limiter(60, 60_000);
export const resetSearchLimit = () => {
  searches.reset();
};

/** `%`, `_` and `\` match literally in LIKE. */
const literal = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/**
 * Finding people to invite (TODO Part 21, CB.3): by the start of their username, first name,
 * last name or full name, at least 2 characters, at most 8 results, signed in only.
 */
@Controller("users")
export class UsersController {
  constructor(@Inject(DB) private readonly pool: Pool) {}

  @Get("search")
  async search(@Query("q") raw: unknown, @Req() request: AuthedRequest): Promise<FoundUser[]> {
    const me = request.user;
    if (!me) throw new UnauthorizedException({ error: "signIn" });
    const q = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (q.length < 2 || q.length > 40) throw new BadRequestException({ error: "invalidQuery" });
    if (!searches.allowed(me.id)) throw new HttpException({ error: "tooMany" }, 429);
    searches.record(me.id);
    const prefix = `${literal(q)}%`;
    const res = await this.pool.query<{
      id: string;
      username: string;
      first_name: string;
      last_name: string;
    }>(
      `SELECT id, username, first_name, last_name FROM app.users
       WHERE id <> $2 AND (
         lower(username) LIKE $1 ESCAPE '\\' OR lower(first_name) LIKE $1 ESCAPE '\\'
         OR lower(last_name) LIKE $1 ESCAPE '\\'
         OR lower(first_name || ' ' || last_name) LIKE $1 ESCAPE '\\')
       ORDER BY lower(username) LIMIT 8`,
      [prefix, me.id],
    );
    return res.rows.map((r) => ({
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
    }));
  }
}
