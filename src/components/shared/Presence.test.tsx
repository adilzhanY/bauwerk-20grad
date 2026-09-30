import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Presence } from "./Presence";
import { MOTION_MS } from "./usePresence";

function motion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Presence", () => {
  it("enters, plays its exit with the last value, then leaves", () => {
    motion(false);
    vi.useFakeTimers();
    const { rerender } = render(<Presence value={"Saved"}>{(v) => <p>{v}</p>}</Presence>);
    const wrapper = screen.getByText("Saved").parentElement?.parentElement;
    expect(wrapper?.className).toContain("motion-flow-in");

    rerender(<Presence value={null as string | null}>{(v) => <p>{v}</p>}</Presence>);
    // Still on screen, with its last value, while the exit plays.
    expect(screen.getByText("Saved").parentElement?.parentElement?.className).toContain(
      "motion-flow-out",
    );
    act(() => {
      vi.advanceTimersByTime(MOTION_MS);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("goes at once for people who asked for reduced motion", () => {
    motion(true);
    const { rerender } = render(
      <Presence show>
        <p>Menu</p>
      </Presence>,
    );
    rerender(
      <Presence show={false}>
        <p>Menu</p>
      </Presence>,
    );
    expect(screen.queryByText("Menu")).toBeNull();
  });
});
