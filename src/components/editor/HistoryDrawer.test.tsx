import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "@/App";
import { useRouter } from "@/app/router";
import { createDefaultBuilding, useEditorStore } from "@/store/building";

beforeEach(() => {
  useRouter.setState({ route: { page: "editor" } });
  window.innerWidth = 1600;
  useEditorStore.setState({
    building: createDefaultBuilding("en"),
    language: "en",
    selection: null,
    projectId: null,
  });
});

describe("history drawer", () => {
  it("opens from the clock in the top bar and Escape closes only the drawer", () => {
    render(<App />);
    expect(screen.queryByRole("complementary", { name: "Version history" })).toBeNull();
    const clock = screen.getByRole("button", { name: "Version history" });
    fireEvent.click(clock);
    expect(clock.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("complementary", { name: "Version history" })).toBeTruthy();

    useEditorStore.getState().select({ kind: "roof" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Version history" })).toBeNull();
    // The Escape was the drawer's: the selection stays.
    expect(useEditorStore.getState().selection).toEqual({ kind: "roof" });
  });
});
