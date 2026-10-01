import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { PDFParse } from "pdf-parse";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { clientServed, createApp } from "../app";
import { DatabaseStore } from "../files/store";
import { ReportService } from "./report.service";

const url = process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test";

let pool: Pool;
let app: INestApplication;
let base: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: url });
  app = await createApp(pool, { logger: false, files: new DatabaseStore(pool) });
  await app.listen(0);
  const address = (app.getHttpServer() as Server).address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.get(ReportService).close();
  await app.close();
  await pool.end();
});

describe("PDF report", () => {
  it("renders the print view to a PDF whose first page carries the building name", async () => {
    // Needs the built client next to the server; CI builds it first.
    expect(clientServed(), "run npm run build in the repository root first").toBe(true);
    resetIds();
    const building = exampleHouse("de");
    const res = await fetch(`${base}/reports?lang=de`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ building }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(
      /bauwerk-einfamilienhaus-\d{4}-\d{2}-\d{2}\.pdf/,
    );
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const parser = new PDFParse({ data: bytes });
    const text = await parser.getText();
    await parser.destroy();
    expect(text.text).toContain("Einfamilienhaus");
    expect(text.text).toContain("Gebäudebericht");
    expect(text.total).toBeGreaterThanOrEqual(3);
  }, 60000);

  it("rejects an invalid building with 422", async () => {
    resetIds();
    const building = exampleHouse("en");
    building.storeys[0]!.openings[1]!.offset = 4; // overlaps the door
    const res = await fetch(`${base}/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ building }),
    });
    expect(res.status).toBe(422);
  });
});
