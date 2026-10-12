import "reflect-metadata";
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { FILE_TYPES } from "./files/files.service";
import type { FileStore } from "./files/store";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import { createAppModule } from "./app.module";
import { ensureSchema } from "./db";
import { AuthService, Unauthenticated } from "./auth/auth.service";
import type { AuthConfig } from "./auth/auth.service";
import { bearer } from "./auth/auth.guard";
import type { NextFunction, Request, Response } from "express";

/** The built client, served alongside the API so the PDF endpoint can print it. */
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
export const clientServed = (): boolean => existsSync(`${DIST}index.html`);

export async function createApp(
  pool: Pool,
  options: { logger?: boolean; auth?: AuthConfig; files?: FileStore } = {},
): Promise<INestApplication> {
  await ensureSchema(pool);
  const app = await NestFactory.create<NestExpressApplication>(
    createAppModule(pool, options.auth, options.files),
    {
      logger: options.logger === false ? false : ["log", "warn", "error"],
      bodyParser: false,
    },
  );
  // Requests reach the server through Caddy on the local network: its X-Forwarded-For names
  // the real address, which the sign in limits count. Only proxies on local and private
  // networks are believed, so a client cannot fake its address from outside.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  // Before anything else, so a refusal below still carries the CORS headers the browser needs.
  app.enableCors({ origin: true, exposedHeaders: ["ETag"] });
  app.useBodyParser("json", { limit: "5mb" });
  // Project files (photos, plans, PDFs, documents), sent as the raw file; 50 MB as Supabase's
  // free plan allows. What each route accepts is checked there.
  const files = ["image/*", ...FILE_TYPES];
  // Up to 50 MB held in memory is only read for a signed in user: the token is checked before
  // the body (the guard checks the route itself later, as for every request).
  const auth = app.get(AuthService);
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!auth.enabled || !request.is(files)) {
      next();
      return;
    }
    auth.verify(bearer(request.headers.authorization)).then(
      () => {
        next();
      },
      (error: unknown) => {
        if (error instanceof Unauthenticated) response.status(401).json({ error: "signIn" });
        else next(error);
      },
    );
  });
  app.useBodyParser("raw", { type: files, limit: "50mb" });
  app.useWebSocketAdapter(new IoAdapter(app));
  if (clientServed()) app.useStaticAssets(DIST);
  return app;
}
