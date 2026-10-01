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
import { MembersController } from "./projects/members.controller";
import { MembersService } from "./projects/members.service";
import { LiveProjects } from "./projects/live.service";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";
import { ProjectsController } from "./projects/projects.controller";
import { UsersController } from "./users/users.controller";
import { FilesController } from "./files/files.controller";
import { ThreadsController } from "./threads/threads.controller";
import { VersionsController } from "./projects/versions.controller";
import { ThreadsService } from "./threads/threads.service";
import { FILE_STORE, FilesService } from "./files/files.service";
import { fileStoreFromEnv } from "./files/store";
import type { FileStore } from "./files/store";
import { ProjectsGateway } from "./projects/projects.gateway";
import { ProjectsService } from "./projects/projects.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportService } from "./reports/report.service";

export function createAppModule(
  pool: Pool = createPool(),
  auth: AuthConfig = authConfigFromEnv(),
  files?: FileStore,
) {
  @Module({
    controllers: [
      HealthController,
      AuthController,
      MeController,
      ProjectsController,
      MembersController,
      UsersController,
      NotificationsController,
      FilesController,
      ThreadsController,
      VersionsController,
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
      NotificationsService,
      MembersService,
      LiveProjects,
      { provide: FILE_STORE, useValue: files ?? fileStoreFromEnv(pool) },
      FilesService,
      ThreadsService,
      ProjectsGateway,
      ReportService,
    ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are declared as empty classes
  class AppModule {}
  return AppModule;
}
