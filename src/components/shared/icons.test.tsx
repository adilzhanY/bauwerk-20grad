import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import * as Icons from "./icons";

describe("custom icons", () => {
  it.each(Object.entries(Icons))("%s renders like a lucide icon", (_, Icon) => {
    const { container } = render(<Icon size={13} className="text-muted" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("13");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.classList.contains("text-muted")).toBe(true);
    // Something is drawn, and nothing leaves the 24 px box.
    expect(svg?.children.length).toBeGreaterThan(0);
  });
});
