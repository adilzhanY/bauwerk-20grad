import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CustomSelect } from "@/components/shared/CustomSelect";

const options = [
  { value: "a", label: "Apple", detail: "1.4" },
  { value: "b", label: "Banana", color: "#ff0" },
  { value: "c", label: "Cherry", disabled: true },
  { value: "d", label: "Date" },
] as const;

type V = (typeof options)[number]["value"];

function Harness({ onChange }: { onChange?: (v: V) => void }) {
  const [v, setV] = useState<V>("a");
  return (
    <CustomSelect
      label="Fruit"
      value={v}
      options={options}
      onChange={(x) => {
        setV(x);
        onChange?.(x);
      }}
    />
  );
}

describe("CustomSelect", () => {
  it("is a combobox that opens a listbox and picks with the mouse", () => {
    render(<Harness />);
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger.textContent).toContain("Apple");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Fruit" });
    expect(list).toBeTruthy();
    expect(screen.getByRole("option", { name: /Apple/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("option", { name: /Date/ }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox").textContent).toContain("Date");
  });

  it("navigates with the keyboard, skips disabled options, Enter picks, Escape closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // Banana
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // skips Cherry, Date
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-3$/);
    fireEvent.keyDown(trigger, { key: "Home" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-0$/);
    fireEvent.keyDown(trigger, { key: "End" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-3$/);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("d");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(trigger, { key: " " });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("type-ahead picks a closed select and highlights an open one", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "b" });
    expect(onChange).toHaveBeenCalledWith("b");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "d" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/-3$/);
  });

  it("closes on an outside click", () => {
    render(
      <div>
        <Harness />
        <button type="button">Elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
