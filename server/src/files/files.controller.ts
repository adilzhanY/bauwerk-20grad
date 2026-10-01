import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { isUuid } from "../projects/projects.service";
import type { Response } from "express";
import type { AuthedRequest } from "../auth/auth.guard";
import { granted } from "../projects/projects.controller";
import { ProjectsService } from "../projects/projects.service";
import { FILE_TYPES, FilesService, SLOT } from "./files.service";
import { MAX_FILE_BYTES } from "./store";

/** Shown in the browser: pictures and PDFs. Everything else downloads. */
const INLINE = /^(image\/|application\/pdf$)/;

/** The file's name from its header, sent URI-encoded so any language survives. */
function nameOf(header: string | undefined): string {
  try {
    let name = "";
    // Control characters and path separators out, everything else kept.
    for (const c of decodeURIComponent(header ?? "")) {
      if (c.charCodeAt(0) >= 32 && c !== "/" && c !== "\\") name += c;
    }
    name = name.trim();
    return name.slice(0, 200);
  } catch {
    return "";
  }
}

/** A size header: a positive whole number, or nothing. */
const sizeOf = (header: string | undefined) => {
  const n = Number(header);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : null;
};

/**
 * A project's files (TODO Part 21, CD.3): everyone with access lists and reads them, editors
 * upload and delete. Bytes always pass through here after the access check, never by a public
 * address. ponytail: bytes go through this server; signed storage links if traffic grows.
 */
@Controller("projects/:id/files")
export class FilesController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  @Get()
  async list(@Param("id") id: string, @Req() request: AuthedRequest) {
    granted(await this.projects.access(id, request.user, "see"));
    return this.files.list(id);
  }

  /** The raw file as the body; its name in X-File-Name, an optional slot in X-Slot. */
  @Post()
  async upload(
    @Param("id") id: string,
    @Req() request: AuthedRequest,
    @Headers("content-type") mime?: string,
    @Headers("x-file-name") rawName?: string,
    @Headers("x-slot") slot?: string,
    @Headers("x-width") width?: string,
    @Headers("x-height") height?: string,
  ) {
    granted(await this.projects.access(id, request.user, "edit"));
    const data: unknown = request.body;
    const type = mime?.split(";")[0]?.trim().toLowerCase() ?? "";
    const name = nameOf(rawName);
    if (
      !(FILE_TYPES as readonly string[]).includes(type) ||
      !Buffer.isBuffer(data) ||
      data.length === 0 ||
      data.length > MAX_FILE_BYTES ||
      !name ||
      (slot !== undefined && !SLOT.test(slot))
    ) {
      throw new BadRequestException({ error: "invalidFile" });
    }
    return this.files.add(
      id,
      { name, mime: type, data, slot: slot ?? null, width: sizeOf(width), height: sizeOf(height) },
      request.user?.id,
    );
  }

  @Get(":fileId")
  async read(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Req() request: AuthedRequest,
    @Res() response: Response,
  ) {
    granted(await this.projects.access(id, request.user, "see"));
    const file = isUuid(fileId) ? await this.files.read(id, "id", fileId) : null;
    if (!file) throw new NotFoundException();
    send(response, file.record.mime, file.record.name, file.data);
  }

  @Delete(":fileId")
  @HttpCode(204)
  async remove(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Req() request: AuthedRequest,
  ) {
    granted(await this.projects.access(id, request.user, "edit"));
    if (!isUuid(fileId) || !(await this.files.remove(id, "id", fileId))) {
      throw new NotFoundException();
    }
  }
}

/** The bytes, typed as stored, never sniffed into something else. */
export function send(response: Response, mime: string, name: string, data: Buffer) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "private, max-age=300");
  response.setHeader(
    "Content-Disposition",
    `${INLINE.test(mime) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
  );
  response.type(mime).send(data);
}
