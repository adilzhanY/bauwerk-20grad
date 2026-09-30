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
@Injectable()
export class ReportService implements OnModuleDestroy {
  private browser: Browser | null = null;

  async renderPdf(building: Building, language: "en" | "de", baseUrl: string): Promise<Buffer> {
    this.browser ??= await chromium.launch();
    const context = await this.browser.newContext();
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
    await this.browser?.close();
    this.browser = null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
