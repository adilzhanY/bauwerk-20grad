import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Quad } from "lod2-core/photo";
import { PhotoStage } from "./PhotoStage";

vi.mock("@/components/photo-editor/useElementSize", () => ({
  useElementSize: () => ({ width: 1000, height: 1000 }),
}));

const corners: Quad = [
  { x: 100, y: 100 },
  { x: 900, y: 100 },
  { x: 900, y: 900 },
  { x: 100, y: 900 },
];

describe("PhotoStage corner dots", () => {
  it("are buttons the arrow keys move, Shift for a bigger step", () => {
    const onCornersChange = vi.fn();
    render(
      <PhotoStage
        scanning={false}
        dotsProposed={false}
        photoUrl="blob:photo"
        loupeUrl={null}
        loupeZoom={2}
        onLoupeZoom={() => undefined}
        photoSize={{ width: 1000, height: 1000 }}
        corners={corners}
        onPhotoLoaded={() => undefined}
        onPhotoError={() => undefined}
        onCornersChange={onCornersChange}
      />,
    );
    const dot = screen.getByRole("button", { name: "Top left corner, the arrow keys move it" });
    fireEvent.keyDown(dot, { key: "ArrowRight" });
    const small = (onCornersChange.mock.lastCall?.[0] as Quad)[0];
    expect(small.x).toBeGreaterThan(100);
    expect(small.y).toBeCloseTo(100);
    fireEvent.keyDown(dot, { key: "ArrowUp", shiftKey: true });
    const big = (onCornersChange.mock.lastCall?.[0] as Quad)[0];
    expect(big.x).toBeCloseTo(100);
    expect(100 - big.y).toBeGreaterThan(5 * (small.x - 100));
  });
});
