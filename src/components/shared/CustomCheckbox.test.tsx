import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";

describe("CustomCheckbox", () => {
  it("is a checkbox that toggles on click, Space and label click", () => {
    const onChange = vi.fn();
    render(<CustomCheckbox label="Show grid" checked={false} onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Show grid" });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: " " });
    fireEvent.click(screen.getByText("Show grid"));
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("renders a switch role when asked and ignores input when disabled", () => {
    const onChange = vi.fn();
    render(<CustomCheckbox variant="switch" label="Heated" checked disabled onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Heated" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    expect(sw.getAttribute("tabindex")).toBe("-1");
  });
});
