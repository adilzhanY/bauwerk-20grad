import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { CustomSwatches } from "@/components/shared/CustomSwatches";

function Harness() {
  const [c, setC] = useState("#e76f51");
  return <CustomSwatches label="Colour" value={c} onChange={setC} />;
}

describe("CustomSwatches", () => {
  it("is a radiogroup of six colours, arrow keys move and click picks", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Colour" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(within(group).getAllByRole("radio")[1]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getAllByRole("radio")[5]!);
    expect(within(group).getAllByRole("radio")[5]?.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(within(group).getAllByRole("radio")[5]!, { key: "ArrowRight" });
    expect(within(group).getAllByRole("radio")[0]?.getAttribute("aria-checked")).toBe("true");
  });
});
