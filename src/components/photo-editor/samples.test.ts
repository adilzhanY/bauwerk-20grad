import { describe, expect, it, vi } from "vitest";
import {
  SAMPLE_PHOTOS,
  pastedImage,
  sampleFile,
  samplesFor,
} from "@/components/photo-editor/samples";

/**
 * A JPEG answer as fetch gives it. A string body with its type, not the test environment's
 * Blob: Node 22's Response cannot read that Blob (it has no stream()), Node 24 can.
 */
const jpegResponse = () => new Response("jpeg", { headers: { "content-type": "image/jpeg" } });

/** A clipboard with the given items, as the browser hands it to a paste event. */
function clipboard(items: { kind: string; type: string; file?: File }[]): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
  } as unknown as DataTransfer;
}

describe("sample photos", () => {
  it("offers every photo, each with a thumbnail", () => {
    expect(SAMPLE_PHOTOS.map((s) => s.id)).toEqual([
      "DEBE02YY40000BOo",
      "DEBE02YY40000Atr",
      "DEBE02YY400000kY",
      "DEBE02YY400001Vh",
      "DEBE02YY400003eq",
      "DEBE02YY40000BOo-street",
      "DEBE02YY40000Atr-street",
    ]);
    for (const sample of SAMPLE_PHOTOS) {
      expect(sample.id.startsWith(sample.gid)).toBe(true);
      expect(sample.url).toContain(sample.id);
      expect(sample.thumb).toContain("thumbs");
    }
  });

  it("puts the photos of the open building first", () => {
    expect(samplesFor("DEBE02YY400000kY")[0]?.gid).toBe("DEBE02YY400000kY");
    expect(
      samplesFor("DEBE02YY40000Atr")
        .map((s) => s.id)
        .slice(0, 2),
    ).toEqual(["DEBE02YY40000Atr", "DEBE02YY40000Atr-street"]);
    expect(samplesFor("DEBE02YY400000kY")).toHaveLength(SAMPLE_PHOTOS.length);
    expect(samplesFor(null).map((s) => s.gid)).toEqual(SAMPLE_PHOTOS.map((s) => s.gid));
  });

  it("downloads a sample as a named image file", async () => {
    const sample = SAMPLE_PHOTOS[0];
    if (!sample) throw new Error("no samples");
    const fetchImpl = vi.fn(() => Promise.resolve(jpegResponse()));
    const file = await sampleFile(sample, fetchImpl);
    expect(file.name).toBe(`${sample.id}.jpg`);
    expect(file.type).toBe("image/jpeg");
    const missing = vi.fn(() => Promise.resolve(new Response("", { status: 404 })));
    await expect(sampleFile(sample, missing as unknown as typeof fetch)).rejects.toThrow("404");
  });
});

describe("pastedImage", () => {
  it("takes the first image and names a nameless screenshot", () => {
    const shot = new File(["png"], "image.png", { type: "image/png" });
    const file = pastedImage(
      clipboard([
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png", file: shot },
      ]),
    );
    expect(file?.name).toBe("pasted-photo.png");
    expect(file?.type).toBe("image/png");
  });

  it("keeps the name of a copied file and ignores text and other files", () => {
    const photo = new File(["jpg"], "facade.jpg", { type: "image/jpeg" });
    expect(pastedImage(clipboard([{ kind: "file", type: "image/jpeg", file: photo }]))?.name).toBe(
      "facade.jpg",
    );
    expect(pastedImage(clipboard([{ kind: "string", type: "text/plain" }]))).toBeNull();
    const pdf = new File(["%PDF"], "plan.pdf", { type: "application/pdf" });
    expect(
      pastedImage(clipboard([{ kind: "file", type: "application/pdf", file: pdf }])),
    ).toBeNull();
    expect(pastedImage(null)).toBeNull();
  });
});
