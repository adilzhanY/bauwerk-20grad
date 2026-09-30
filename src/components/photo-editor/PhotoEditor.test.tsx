import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { wallPlaneFor } from "@/geometry/photoWall";
import { useEditorStore } from "@/store/building";
import { PhotoEditorView } from "@/components/photo-editor/PhotoEditor";
import { detectWall } from "@/components/photo-editor/detection";

// The detection talks to the SAM 3 service; here it only has to be started, with the file.
vi.mock("@/components/photo-editor/detection", () => ({
  detectWall: vi.fn(() => new Promise(() => undefined)),
  detectOpeningsOnly: vi.fn(() => Promise.resolve(null)),
}));
let visionUp: boolean | null = true;
vi.mock("@/lod2/api/useVisionAvailable", () => ({
  useVisionAvailable: () => visionUp,
}));
import type { WallGeometry } from "@/components/photo-editor/useWallGeometry";

function wall(): WallGeometry {
  const plane = wallPlaneFor(exampleHouse("en"), 0);
  return { ring: null, plane, groundZ: 0, buriedDepth: 0, area: 50, facing: 180 };
}

/** A paste event carrying one file, as the browser sends it for a copied image. */
function pasteFile(file: File) {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { items: [{ kind: "file", type: file.type, getAsFile: () => file }] },
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

/** The first of `elements`, or a failed test. */
function first(elements: HTMLElement[]): HTMLElement {
  const element = elements[0];
  if (!element) throw new Error("nothing found");
  return element;
}

const photoShown = () => document.querySelector("img.photo-editor-image");

/** jsdom measures nothing; the stages only need the observer to exist. */
class NoResizeObserver {
  observe() {
    return undefined;
  }
  unobserve() {
    return undefined;
  }
  disconnect() {
    return undefined;
  }
}

beforeEach(() => {
  visionUp = true;
  vi.mocked(detectWall).mockClear();
  vi.stubGlobal("ResizeObserver", NoResizeObserver);
  useEditorStore.setState({ language: "en" });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${String((n += 1))}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // Unmount first: a photo still loading when the test ends would otherwise mount its stage
  // after the ResizeObserver stand-in is gone, and fail the next moment (a flaky test).
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("photo editor size", () => {
  it("has one fixed width that never comes from the image", () => {
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    const dialog = screen.getByRole("dialog");
    // A width taken from the image resized the columns in a loop and flashed (kY).
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).not.toContain("w-fit");
    expect(dialog.style.width).toBe("");
  });
});

describe("photo editor without a photo", () => {
  it("offers Choose photo in the middle of the stage, not in the header", () => {
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    expect(screen.getByRole("heading", { name: "Add a photo of this facade" })).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Choose photo" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.closest("header")).toBeNull();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(first(buttons));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByText(/paste a copied image/)).toBeTruthy();
  });

  it("opens a pasted image as the photo and moves Choose photo to the header", () => {
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    const event = pasteFile(new File(["png"], "image.png", { type: "image/png" }));
    expect(event.defaultPrevented).toBe(true);
    expect(photoShown()).toBeTruthy();
    const choose = screen.getByRole("button", { name: "Choose photo" });
    expect(choose.closest("header")).toBeTruthy();
  });

  it("ignores pasted text and pastes into a text field", () => {
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    const text = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(text, "clipboardData", {
      value: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] },
    });
    act(() => {
      document.dispatchEvent(text);
    });
    expect(photoShown()).toBeNull();
    expect(text.defaultPrevented).toBe(false);
  });

  it("loads a sample photo, the open building's own first", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Blob(["jpeg"], { type: "image/jpeg" })));
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} buildingGid="DEBE02YY400000kY" />);
    const samples = within(screen.getByRole("list"));
    const own = first(samples.getAllByRole("button"));
    expect(own.textContent).toContain("This building");
    expect(own.textContent).toContain("DEBE02YY400000kY");
    fireEvent.click(own);
    await waitFor(() => {
      expect(photoShown()).toBeTruthy();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("DEBE02YY400000kY.jpg");
  });

  it("says so when a sample cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    fireEvent.click(first(within(screen.getByRole("list")).getAllByRole("button")));
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
    expect(photoShown()).toBeNull();
  });
});

describe("a new photo starts the detection, however it arrives", () => {
  const photo = () => new File(["jpg"], "facade.jpg", { type: "image/jpeg" });

  it("chosen from the disk", () => {
    const { container } = render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input");
    const file = photo();
    fireEvent.change(input, { target: { files: [file] } });
    expect(photoShown()).toBeTruthy();
    expect(detectWall).toHaveBeenCalledOnce();
    expect(vi.mocked(detectWall).mock.calls[0]?.[0]).toBe(file);
  });

  it("pasted", () => {
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    pasteFile(photo());
    expect(detectWall).toHaveBeenCalledOnce();
  });

  it("picked from the samples", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["jpeg"], { type: "image/jpeg" })),
    );
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    fireEvent.click(first(within(screen.getByRole("list")).getAllByRole("button")));
    await waitFor(() => {
      expect(detectWall).toHaveBeenCalledOnce();
    });
  });

  it("not without the vision service: the photo opens for placing the corners by hand", () => {
    visionUp = false;
    render(<PhotoEditorView open onClose={vi.fn()} wall={wall()} />);
    pasteFile(photo());
    expect(photoShown()).toBeTruthy();
    expect(detectWall).not.toHaveBeenCalled();
  });
});
