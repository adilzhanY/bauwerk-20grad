import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomField, CustomReadOnly, CustomSection } from "@/components/shared/CustomField";

describe("CustomField", () => {
  it("associates the label with the control and shows an error as an alert", () => {
    render(
      <CustomField label="Height" htmlFor="h" error="Too tall">
        <input id="h" />
      </CustomField>,
    );
    expect(screen.getByLabelText("Height")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Too tall");
  });

  it("section title is a heading and read-only shows label and value", () => {
    render(
      <CustomSection title="Storeys">
        <CustomReadOnly label="Length" value="10 m" />
      </CustomSection>,
    );
    expect(screen.getByRole("heading", { name: "Storeys" })).toBeTruthy();
    expect(screen.getByText("10 m")).toBeTruthy();
  });

  it("a collapsible section starts closed and opens from its title", () => {
    render(
      <CustomSection title="Location" collapsible>
        <CustomReadOnly label="Latitude" value="52.5°" />
      </CustomSection>,
    );
    const toggle = screen.getByRole("button", { name: "Location" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("52.5°")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("52.5°")).toBeTruthy();
  });
});
