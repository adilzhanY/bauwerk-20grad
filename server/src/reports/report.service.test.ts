import { describe, expect, it, vi } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { ReportService, ReportsBusy } from "./report.service";

describe("ReportService queue", () => {
  it("prints two at a time, queues a few, refuses the rest, and launches one browser", async () => {
    const service = new ReportService();
    const releases: (() => void)[] = [];
    let printing = 0;
    let most = 0;
    // Stand-in for the browser work: each print waits until the test lets it finish.
    vi.spyOn(service as unknown as { print: () => Promise<Buffer> }, "print").mockImplementation(
      () =>
        new Promise<Buffer>((resolve) => {
          printing += 1;
          most = Math.max(most, printing);
          releases.push(() => {
            printing -= 1;
            resolve(Buffer.from("pdf"));
          });
        }),
    );
    const ask = () => service.renderPdf(exampleHouse("en"), "en", "http://x");
    const jobs = Array.from({ length: 10 }, ask);
    const refused = ask();
    await expect(refused).rejects.toBeInstanceOf(ReportsBusy);
    // Let every print finish in turn; the queued ones move up two at a time.
    while (releases.length > 0 || printing > 0) {
      await new Promise((r) => setTimeout(r, 0));
      releases.shift()?.();
    }
    await expect(Promise.all(jobs)).resolves.toHaveLength(10);
    expect(most).toBe(2);
  });
});
