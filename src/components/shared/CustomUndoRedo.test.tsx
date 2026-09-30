import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomUndoRedo } from "@/components/shared/CustomUndoRedo";

describe("CustomUndoRedo", () => {
  it("names both buttons, shows the shortcut and calls back", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(<CustomUndoRedo canUndo canRedo onUndo={onUndo} onRedo={onRedo} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo.getAttribute("title")).toBe("Undo (Ctrl+Z)");
    fireEvent.click(undo);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("disables what cannot be done", () => {
    render(<CustomUndoRedo canUndo={false} canRedo onUndo={vi.fn()} onRedo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false);
  });
});
