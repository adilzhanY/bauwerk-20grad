import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEditorStore } from "@/store/building";
import { OpeningsList } from "@/components/photo-editor/OpeningsPanels";

describe("the openings list", () => {
  it("picks an opening with a real button, which the keyboard reaches", () => {
    useEditorStore.setState({ language: "en" });
    const onSelect = vi.fn();
    const window = { x: 0, y: 0, width: 1.2, height: 1.4 };
    render(
      <OpeningsList
        openings={[window, { ...window, x: 2 }]}
        selected={0}
        summary={{ count: 2, openingArea: 3.36, wallArea: 20, ratio: 0.168 }}
        onSelect={onSelect}
      />,
    );
    const second = screen.getByRole("button", { name: "Opening 2" });
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Opening 1" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(second);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
