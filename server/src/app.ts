import "reflect-metadata";
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplication } from "@nestjs/common";
import type { Pool } from "pg";
import { createAppModule } from "./app.module";
import { ensureSchema } from "./db";
import type { AuthConfig } from "./auth/auth.service";

/** The built client, served alongside the API so the PDF endpoint can print it. */
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
export const clientServed = (): boolean => existsSync(`${DIST}index.html`);

export async function createApp(
  pool: Pool,
  options: { logger?: boolean; auth?: AuthConfig } = {},
): Promise<INestApplication> {
  await ensureSchema(pool);
  const app = await NestFactory.create<NestExpressApplication>(
    createAppModule(pool, options.auth),
    {
      logger: options.logger === false ? false : ["log", "warn", "error"],
      bodyParser: false,
    },
  );
  app.useBodyParser("json", { limit: "5mb" });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({ origin: true, exposedHeaders: ["ETag"] });
  if (clientServed()) app.useStaticAssets(DIST);
  return app;
}
