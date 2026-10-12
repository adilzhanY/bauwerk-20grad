/**
 * The pages of a PDF as pictures, with the text printed on each: a PDF of the floor plans of a
 * whole building becomes one picture per storey, and the text says which storey it shows.
 * pdf.js is loaded only when a PDF is opened, so the editor's bundle does not carry it.
 */

export interface PdfPage {
  /** The page drawn as a PNG, about `maxSide` pixels on its longer side. */
  image: Blob;
  width: number;
  height: number;
  /** Every word on the page, joined; empty for a scan. */
  text: string;
}

/** The most pages drawn: each is a 2400 px picture drawn on the main thread. */
export const MAX_PDF_PAGES = 20;

/**
 * The first `MAX_PDF_PAGES` pages of `file`, drawn one after another, and how many the PDF
 * has. `signal` stops it between pages, with the signal's reason as the error.
 */
export async function pdfPages(
  file: Blob,
  signal?: AbortSignal,
  maxSide = 2400,
): Promise<{ pages: PdfPage[]; total: number }> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: PdfPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("The page could not be drawn."));
        }, "image/png");
      });
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push({ image, width: canvas.width, height: canvas.height, text });
      page.cleanup();
    }
    return { pages, total: doc.numPages };
  } finally {
    void task.destroy();
  }
}

/** Whether a picked or pasted file is a PDF. */
export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
