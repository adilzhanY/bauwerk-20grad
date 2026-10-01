import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";

function Broken(): never {
  throw new Error("saved data broke it");
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the error page", () => {
  it("speaks German when chosen, and Reset forgets the open project and unsent edits", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    localStorage.setItem("bauwerk.language", "de");
    localStorage.setItem("bauwerk.openProject", "p1");
    localStorage.setItem("bauwerk.project.p1", "{}");
    localStorage.setItem("bauwerk.queue.s1", "[]");
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(
      screen.getByRole("heading", { name: "Bauwerk wurde mit einem Fehler beendet" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Lokale Daten zurücksetzen und neu laden" }),
    );
    expect(localStorage.getItem("bauwerk.openProject")).toBeNull();
    expect(localStorage.getItem("bauwerk.queue.s1")).toBeNull();
    // The saved project itself stays in the list.
    expect(localStorage.getItem("bauwerk.project.p1")).toBe("{}");
    expect(reload).toHaveBeenCalled();
  });
});
