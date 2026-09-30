import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
