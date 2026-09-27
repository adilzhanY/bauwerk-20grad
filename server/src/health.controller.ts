import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Pool } from "pg";
import { DB } from "./db";
import { Public } from "./auth/auth.guard";

/** For the container health check: the process answers and the database does too. Open. */
@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly pool: Pool) {}

  @Get()
  async health() {
    try {
      await this.pool.query("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({ ok: false, database: false });
    }
    return { ok: true };
  }
}
