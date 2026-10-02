import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEditorStore } from "@/store/building";
import { accepts } from "@/lib/accepts";
import { DropZone } from "./DropZone";

const pdf = new File(["%PDF"], "plans.pdf", { type: "application/pdf" });
const photo = new File(["jpg"], "facade.jpg", { type: "image/jpeg" });

describe("the way a file goes in", () => {
  it("takes a file dragged onto it, and refuses one of the wrong type with a line saying so", () => {
    useEditorStore.setState({ language: "en" });
    const onFiles = vi.fn();
    render(<DropZone accept="application/pdf,.pdf" onFiles={onFiles} />);
    const zone = screen.getByText("Drag a file here").parentElement!;
    fireEvent.drop(zone, { dataTransfer: { files: [photo] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByText("facade.jpg cannot be used here.")).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: { files: [pdf] } });
    expect(onFiles).toHaveBeenCalledWith([pdf]);
  });

  it("takes a file chosen from the computer, and one pasted anywhere on the page", () => {
    useEditorStore.setState({ language: "en" });
    const onFiles = vi.fn();
    render(<DropZone accept="image/*" multiple onFiles={onFiles} />);
    fireEvent.change(screen.getByLabelText("Choose from your computer", { selector: "input" }), {
      target: { files: [photo, photo] },
    });
    expect(onFiles).toHaveBeenLastCalledWith([photo, photo]);
    const pasted = new File(["png"], "image.png", { type: "image/png" });
    const paste = Object.assign(new Event("paste", { bubbles: true, cancelable: true }), {
      clipboardData: { files: [pasted] },
    });
    document.body.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect((onFiles.mock.lastCall?.[0] as File[])[0]?.name).toBe("pasted.png");
  });

  it("reads a file input's accept list", () => {
    expect(accepts(pdf, "application/pdf")).toBe(true);
    expect(accepts(pdf, ".PDF")).toBe(true);
    expect(accepts(photo, "image/*")).toBe(true);
    expect(accepts(photo, "application/pdf,.pdf")).toBe(false);
    expect(accepts(photo, undefined)).toBe(true);
  });
});
