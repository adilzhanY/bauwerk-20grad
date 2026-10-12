import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_PAGES, pdfPages } from "./pdfPages";

/** A fake pdf.js document of `numPages` pages; `drawn` counts the pages rendered. */
const fake = vi.hoisted(() => ({
  numPages: 0,
  drawn: 0,
  onDraw: (): void => undefined,
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    destroy: () => Promise.resolve(),
    promise: Promise.resolve({
      numPages: fake.numPages,
      getPage: () =>
        Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 50 * scale,
          }),
          render: () => {
            fake.drawn++;
            fake.onDraw();
            return { promise: Promise.resolve() };
          },
          getTextContent: () => Promise.resolve({ items: [{ str: "Erdgeschoss" }] }),
          cleanup: () => undefined,
        }),
    }),
  }),
}));

beforeEach(() => {
  fake.drawn = 0;
  fake.onDraw = () => undefined;
  HTMLCanvasElement.prototype.toBlob = function (done: BlobCallback) {
    done(new Blob(["png"]));
  };
});

describe("pdfPages", () => {
  it("draws only the first pages of a long PDF and says how many it has", async () => {
    fake.numPages = MAX_PDF_PAGES + 5;
    const { pages, total } = await pdfPages(new Blob(["pdf"]));
    expect(pages).toHaveLength(MAX_PDF_PAGES);
    expect(total).toBe(MAX_PDF_PAGES + 5);
    expect(pages[0]).toMatchObject({ width: 2400, height: 1200, text: "Erdgeschoss" });
  });

  it("stops between pages once aborted", async () => {
    fake.numPages = 10;
    const controller = new AbortController();
    fake.onDraw = () => {
      if (fake.drawn === 2) controller.abort();
    };
    await expect(pdfPages(new Blob(["pdf"]), controller.signal)).rejects.toThrow();
    expect(fake.drawn).toBe(2);
  });
});
