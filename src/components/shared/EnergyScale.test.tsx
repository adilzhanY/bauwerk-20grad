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

  it("keeps the labels of values past the scale inside it, lined up with its right end", () => {
    const current = { ...computeEnergy(exampleHouse("en")), specificEndEnergy: 336 };
    const compare = { ...current, specificEndEnergy: 344 };
    const { container } = render(
      <EnergyScale current={current} compare={compare} compareLabel="Scenario 1" variant="panel" />,
    );
    const labels = [...container.querySelectorAll("text")].filter((t) =>
      /^(Current|Scenario 1): /.test(t.textContent),
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.getAttribute("text-anchor")).toBe("end");
      expect(label.getAttribute("x")).toBe("400");
    }
    // The arrows stay whole inside the 400 wide scale.
    for (const path of container.querySelectorAll("path")) {
      const x = Number(/^M([\d.]+)/.exec(path.getAttribute("d") ?? "")?.[1]);
      expect(x).toBeLessThanOrEqual(395);
    }
  });
});
