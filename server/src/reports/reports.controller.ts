import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/auth.guard";
import { granted } from "../projects/projects.controller";
import { EXPORT_VERSION, fromJson } from "@/geometry/export";
import { clientServed } from "../app";
import { ProjectsService } from "../projects/projects.service";
import { ReportService, ReportsBusy } from "./report.service";
import type { Building } from "@/geometry/types";

const fileName = (name: string) => {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, "-")
      .replace(/^-|-$/g, "") || "building";
  return `bauwerk-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
};

const lang = (q: string | undefined): "en" | "de" => (q === "de" ? "de" : "en");
/** Chromium only needs the client served by this process, never an untrusted Host target. */
const baseUrlOf = (req: Request) => `http://127.0.0.1:${req.socket.localPort}`;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

@Controller("reports")
export class ReportsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  /** The PDF, or 503 while the printer is full (a few at a time, see ReportService). */
  private async pdf(building: Building, language: "en" | "de", baseUrl: string) {
    try {
      return await this.reports.renderPdf(building, language, baseUrl);
    } catch (error) {
      if (error instanceof ReportsBusy) throw new ServiceUnavailableException({ error: "busy" });
      throw error;
    }
  }

  /** PDF of a stored project. */
  @Post(":projectId")
  @HttpCode(200)
  @Header("Content-Type", "application/pdf")
  async forProject(
    @Param("projectId") id: string,
    @Query("lang") language: string | undefined,
    @Query("version") rawVersion: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    // A member's report only, like every other project route, and before anything else.
    granted(await this.projects.access(id, req.user, "see"));
    if (!clientServed()) throw new ServiceUnavailableException("client build not served");
    const project = await this.projects.get(id);
    if (!project) throw new NotFoundException();
    // The report of a named version prints the building as it was then (TODO Part 21, CG.2).
    const version = Number(rawVersion);
    let building = project.building;
    if (rawVersion !== undefined && Number.isInteger(version) && version !== project.version) {
      const then = await this.projects.buildingAt(id, version);
      if (!then.ok) throw new NotFoundException();
      building = then.building;
    }
    const pdf = await this.pdf(building, lang(language), baseUrlOf(req));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName(project.building.name)}"`,
    );
    res.end(pdf);
  }

  /** PDF of a building sent in the body, for clients that work without a project. */
  @Post()
  @HttpCode(200)
  @Header("Content-Type", "application/pdf")
  async forBody(
    @Body() body: unknown,
    @Query("lang") language: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!isRecord(body) || !("building" in body)) {
      res.status(400).json({ error: "buildingRequired" });
      return;
    }
    const parsed = fromJson(
      JSON.stringify({ format: "bauwerk", version: EXPORT_VERSION, building: body.building }),
    );
    if (!parsed.ok) {
      res.status(parsed.error.code === "invalidStructure" ? 400 : 422).json({
        error: "invalid",
        detail: parsed.error,
      });
      return;
    }
    if (!clientServed()) throw new ServiceUnavailableException("client build not served");
    const pdf = await this.pdf(parsed.building, lang(language), baseUrlOf(req));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName(parsed.building.name)}"`,
    );
    res.end(pdf);
  }
}
