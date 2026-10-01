import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy } from "@nestjs/common";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { toJson } from "@/geometry/export";
import type { Building } from "@/geometry/types";

/**
 * Prints the client's own print view to an A4 PDF: headless Chromium opens the
 * served client at `/?print=1` with the building placed in localStorage as the saved project
 * the editor had open (src/lib/storage.ts), so the PDF is the page the user's browser would
 * print.
 * The server must serve the built client (see app.ts); without it the endpoint
 * reports 503.
 */
/** PDFs printed at the same time; each holds a browser page with the whole 3D app. */
const PARALLEL = 2;
/** Requests waiting for a turn; more than that is refused as busy rather than queued forever. */
const QUEUE = 8;

/** Too many reports are being printed; the controller answers 503, try again shortly. */
export class ReportsBusy extends Error {}

@Injectable()
export class ReportService implements OnModuleDestroy {
  // The launch itself, so two first requests at once share one browser instead of starting two.
  private browser: Promise<Browser> | null = null;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  async renderPdf(building: Building, language: "en" | "de", baseUrl: string): Promise<Buffer> {
    await this.turn();
    try {
      return await this.print(building, language, baseUrl);
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  private async turn(): Promise<void> {
    if (this.running < PARALLEL) {
      this.running += 1;
      return;
    }
    if (this.waiting.length >= QUEUE) throw new ReportsBusy();
    // The finishing print hands its place over directly, so `running` stays the same.
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private async print(building: Building, language: "en" | "de", baseUrl: string) {
    this.browser ??= chromium.launch().catch((error: unknown) => {
      this.browser = null;
      throw error;
    });
    const context = await (await this.browser).newContext();
    try {
      await context.addInitScript(
        ({ json, lang }: { json: string; lang: string }) => {
          localStorage.setItem("bauwerk.project.print", json);
          localStorage.setItem("bauwerk.openProject", "print");
          localStorage.setItem("bauwerk.language", lang);
          localStorage.setItem("bauwerk.theme", "light");
        },
        { json: toJson(building), lang: language },
      );
      const page = await context.newPage();
      await page.goto(`${baseUrl}/?print=1`, { waitUntil: "networkidle" });
      await page.waitForSelector(".doc", { timeout: 15000 });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "16mm", bottom: "16mm", left: "18mm", right: "18mm" },
      });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    await (await browser?.catch(() => null))?.close();
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
