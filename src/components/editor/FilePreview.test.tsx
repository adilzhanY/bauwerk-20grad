import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEditorStore } from "@/store/building";
import { FilePreview } from "./FilePreview";

describe("deleting what the preview shows", () => {
  it("asks first, then deletes and closes", async () => {
    useEditorStore.setState({ language: "en" });
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <FilePreview
        item={{
          kind: "url",
          title: "Floor plan, Ground floor",
          url: "blob:plan",
          mime: "image/png",
          fileName: "plan.png",
          remove: { label: "Delete", title: "Delete the floor plan?", body: "Gone for all.", run },
        }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const asking = await screen.findByRole("dialog", { name: "Delete the floor plan?" });
    expect(run).not.toHaveBeenCalled();
    // Cancel keeps it.
    fireEvent.click(within(asking).getByText("Cancel", { selector: "button" }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete the floor plan?" });
    const buttons = confirm.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("then asks whether the walls and doors go too, and deletes only after that answer", async () => {
    useEditorStore.setState({ language: "en" });
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <FilePreview
        item={{
          kind: "url",
          title: "Floor plan, Ground floor",
          url: "blob:plan",
          mime: "image/png",
          fileName: "plan.png",
          remove: {
            label: "Delete",
            title: "Delete the floor plan?",
            body: "Gone for all.",
            also: {
              title: "Walls too?",
              body: "6 walls.",
              yes: "Remove them too",
              no: "Keep them",
            },
            run,
          },
        }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete the floor plan?" });
    const buttons = confirm.querySelectorAll("button");
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    const also = await screen.findByRole("dialog", { name: "Walls too?" });
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(within(also).getByRole("button", { name: "Remove them too" }));
    expect(run).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers no delete when the item has none (people who may only look)", () => {
    useEditorStore.setState({ language: "en" });
    render(
      <FilePreview
        item={{
          kind: "url",
          title: "Plan",
          url: "blob:plan",
          mime: "image/png",
          fileName: "p.png",
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });
});
