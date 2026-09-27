import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { DB, createPool } from "./db";
import { HealthController } from "./health.controller";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsGateway } from "./projects/projects.gateway";
import { ProjectsService } from "./projects/projects.service";
import { ReportsController } from "./reports/reports.controller";
import { ReportService } from "./reports/report.service";

export function createAppModule(pool: Pool = createPool()) {
  @Module({
    controllers: [HealthController, ProjectsController, ReportsController],
    providers: [{ provide: DB, useValue: pool }, ProjectsService, ProjectsGateway, ReportService],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are declared as empty classes
  class AppModule {}
  return AppModule;
}
