import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AUTH_CONFIG, AuthService, authConfigFromEnv } from "./auth/auth.service";
import type { AuthConfig } from "./auth/auth.service";
import type { Pool } from "pg";
import { DB, createPool } from "./db";
import { HealthController } from "./health.controller";
import { MeController } from "./me/me.controller";
import { MeService } from "./me/me.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsGateway } from "./projects/projects.gateway";
import { ProjectsService } from "./projects/projects.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportService } from "./reports/report.service";

export function createAppModule(pool: Pool = createPool(), auth: AuthConfig = authConfigFromEnv()) {
  @Module({
    controllers: [
      HealthController,
      AuthController,
      MeController,
      ProjectsController,
      ReportsController,
    ],
    providers: [
      { provide: DB, useValue: pool },
      { provide: AUTH_CONFIG, useValue: auth },
      AuthService,
      // Every route needs a signed in user when accounts are on, unless marked Public.
      { provide: APP_GUARD, useClass: AuthGuard },
      MeService,
      ProjectsService,
      ProjectsGateway,
      ReportService,
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are declared as empty classes
  class AppModule {}
  return AppModule;
}
