import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CustomTabPanel, CustomTabs } from "@/components/shared/CustomTabs";

const tabs = [
  { value: "properties", label: "Properties" },
  { value: "energy", label: "Energy" },
] as const;

function Harness() {
  const [v, setV] = useState<"properties" | "energy">("properties");
  return (
    <>
      <CustomTabs id="test-tabs" label="Panel" value={v} tabs={tabs} onChange={setV} />
      <CustomTabPanel id="test-tabs" value={v}>
        {v === "energy" ? "Energy content" : "Property content"}
      </CustomTabPanel>
    </>
  );
}

describe("CustomTabs", () => {
  it("is a tablist, click and arrow keys switch, the panel is linked", () => {
    render(<Harness />);
    const list = screen.getByRole("tablist", { name: "Panel" });
    expect(list).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Energy" }));
    expect(screen.getByRole("tabpanel", { name: "Energy" }).textContent).toBe("Energy content");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Energy" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Properties" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Properties" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Energy" }).getAttribute("aria-selected")).toBe("true");
  });
});
