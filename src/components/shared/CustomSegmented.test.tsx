import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { CustomSegmented } from "@/components/shared/CustomSegmented";

const options = [
  { value: "current", label: "Current" },
  { value: "renovated", label: "Renovated" },
  { value: "plan", label: "Plan" },
] as const;

function Harness({ iconsOnly = false }: { iconsOnly?: boolean }) {
  const [v, setV] = useState<(typeof options)[number]["value"]>("current");
  return (
    <CustomSegmented
      label="Scenario"
      value={v}
      options={options}
      onChange={setV}
      iconsOnly={iconsOnly}
    />
  );
}

describe("CustomSegmented", () => {
  it("is a radiogroup with one checked radio and arrow keys move the selection", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Scenario" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(
      within(group).getByRole("radio", { name: "Renovated" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.keyDown(within(group).getByRole("radio", { name: "Renovated" }), {
      key: "ArrowLeft",
    });
    fireEvent.keyDown(within(group).getByRole("radio", { name: "Current" }), { key: "ArrowLeft" });
    expect(within(group).getByRole("radio", { name: "Plan" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(within(group).getByRole("radio", { name: "Current" }));
    expect(within(group).getByRole("radio", { name: "Current" }).getAttribute("tabindex")).toBe(
      "0",
    );
    fireEvent.keyDown(within(group).getByRole("radio", { name: "Current" }), { key: "End" });
    expect(within(group).getByRole("radio", { name: "Plan" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("icon-only mode keeps the accessible name", () => {
    render(<Harness iconsOnly />);
    expect(screen.getByRole("radio", { name: "Renovated" })).toBeTruthy();
  });

  it("segments may shrink and dense groups use the small size so the track never overflows", () => {
    render(
      <CustomSegmented
        label="Roof"
        value="solid"
        options={[
          { value: "hidden", label: "Hidden" },
          { value: "outline", label: "Outline" },
          { value: "ghost", label: "Ghost" },
          { value: "solid", label: "Solid" },
        ]}
        onChange={() => undefined}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const r of radios) {
      expect(r.className).toContain("min-w-0");
      expect(r.className).toContain("text-xs");
    }
  });
});
