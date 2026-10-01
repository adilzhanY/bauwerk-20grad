import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { computeEnergy } from "@/geometry/energy";
import { exampleHouse } from "@/lib/examples";
import { EnergyScale } from "@/components/shared/EnergyScale";

describe("energy scale", () => {
  it("writes the unit on the first tick, clear of the others", () => {
    const { container } = render(
      <EnergyScale current={computeEnergy(exampleHouse("en"))} variant="panel" />,
    );
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("0 kWh/(m²a)");
    // No unit standing on its own where it ran into the 250 tick.
    expect(texts).not.toContain("kWh/(m²a)");
    expect(texts).toContain("250");
  });
});
