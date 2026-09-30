import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadTheme } from "@/lib/storage";
import { useEditorStore } from "@/store/building";
import { startPersistence } from "@/store/persist";
import { ThemeToggle } from "@/components/app/ThemeToggle";

describe("theme toggle", () => {
  let stop: () => void = () => undefined;
  beforeEach(() => {
    localStorage.clear();
    useEditorStore.setState({ language: "en", theme: "light" });
    stop = startPersistence(useEditorStore);
  });
  afterEach(() => {
    stop();
    cleanup();
  });

  it("starts light for a fresh visitor", async () => {
    localStorage.clear();
    vi.resetModules();
    const fresh = await import("@/store/building");
    expect(fresh.useEditorStore.getState().theme).toBe("light");
    expect(fresh.createEditorStore().getState().theme).toBe("light");
  });

  it("switches between light and dark and stores the choice", () => {
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(useEditorStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(loadTheme()).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(useEditorStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(loadTheme()).toBe("light");
  });

  it("follows the theme chosen in the settings", () => {
    render(<ThemeToggle />);
    act(() => {
      useEditorStore.getState().setTheme("dark");
    });
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeTruthy();
  });
});
