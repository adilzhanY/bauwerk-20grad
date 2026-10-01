import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomSelect } from "@/components/shared/CustomSelect";

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
    fireEvent.keyDown(two, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(two);
    fireEvent.keyDown(two, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("leaves Escape to a field that used it, and closes from a plain field", () => {
    const onClose = vi.fn();
    render(
      <CustomDialog title="Rename" closeLabel="Close" onClose={onClose}>
        <input
          aria-label="Name"
          onKeyDown={(e) => {
            e.preventDefault();
          }}
        />
        <input aria-label="Note" />
      </CustomDialog>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the top one of two stacked dialogs", () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <CustomDialog title="New project" closeLabel="Close" onClose={closeBottom}>
        <button type="button">Start</button>
      </CustomDialog>,
    );
    const { unmount } = render(
      <CustomDialog title="Save this project?" closeLabel="Close" onClose={closeTop}>
        <button type="button">Save</button>
      </CustomDialog>,
    );
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
    unmount();
    fireEvent.keyDown(screen.getByRole("button", { name: "Start" }), { key: "Escape" });
    expect(closeBottom).toHaveBeenCalledTimes(1);
  });

  it("Escape in an open select closes the list, not the dialog", () => {
    const onClose = vi.fn();
    render(
      <CustomDialog title="Share" closeLabel="Close" onClose={onClose}>
        <CustomSelect
          label="Role"
          value="a"
          options={[
            { value: "a", label: "Editor" },
            { value: "b", label: "Viewer" },
          ]}
          onChange={() => undefined}
        />
      </CustomDialog>,
    );
    const select = screen.getByRole("combobox", { name: "Role" });
    fireEvent.click(select);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
