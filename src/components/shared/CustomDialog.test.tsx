import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomDialog } from "@/components/shared/CustomDialog";

describe("CustomDialog", () => {
  it("focuses inside, traps Tab, closes on Escape and on the backdrop", () => {
    const onClose = vi.fn();
    render(
      <CustomDialog title="Shortcuts" closeLabel="Close" onClose={onClose}>
        <button type="button">One</button>
        <button type="button">Two</button>
      </CustomDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Shortcuts" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const two = screen.getByRole("button", { name: "Two" });
    two.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("leaves Escape in a text field for that field to handle", () => {
    const onClose = vi.fn();
    render(
      <CustomDialog title="Rename" closeLabel="Close" onClose={onClose}>
        <input aria-label="Name" />
      </CustomDialog>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
