import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomIconButton } from "@/components/shared/CustomIconButton";

describe("CustomIconButton", () => {
  it("takes its accessible name and tooltip from the label", () => {
    render(
      <CustomIconButton label="Measure">
        <svg />
      </CustomIconButton>,
    );
    const b = screen.getByRole("button", { name: "Measure" });
    expect(b.getAttribute("title")).toBe("Measure");
  });

  it("is a toggle when pressed is given", () => {
    const onClick = vi.fn();
    render(
      <CustomIconButton label="Grid" pressed={false} onClick={onClick}>
        <svg />
      </CustomIconButton>,
    );
    const b = screen.getByRole("button", { name: "Grid" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });
});
