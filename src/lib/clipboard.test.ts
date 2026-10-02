import { describe, expect, it } from "vitest";
import { pastedImage } from "./clipboard";

function clipboard(items: { kind: string; type: string; file?: File }[]): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
  } as unknown as DataTransfer;
}

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
