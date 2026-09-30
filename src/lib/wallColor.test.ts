import { describe, expect, it } from "vitest";
import { medianColour, openingRects } from "./wallColor";

/** A width x height image filled with `rgb`, as canvas pixel data. */
function image(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return data;
}

function paint(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * width + x) * 4);
}

describe("medianColour", () => {
  it("finds the plaster's colour and ignores a few dark details", () => {
    const data = image(10, 10, [230, 190, 90]);
    // A drain pipe: one dark column is a tenth of the wall.
    paint(data, 10, 3, 0, 4, 10, [40, 40, 40]);
    expect(medianColour(data, 10, 10)).toBe("#e6be5a");
  });

  it("leaves out the openings, however much of the wall they cover", () => {
    const data = image(10, 10, [200, 60, 50]);
    // Windows cover more than half the picture.
    paint(data, 10, 0, 0, 10, 6, [30, 60, 90]);
    expect(medianColour(data, 10, 10)).toBe("#1e3c5a");
    expect(medianColour(data, 10, 10, [{ x0: 0, y0: 0, x1: 10, y1: 6 }])).toBe("#c83c32");
  });

  it("gives nothing when every pixel is left out or transparent", () => {
    const data = image(4, 4, [255, 255, 255]);
    expect(medianColour(data, 4, 4, [{ x0: 0, y0: 0, x1: 4, y1: 4 }])).toBeNull();
    data.fill(0);
    expect(medianColour(data, 4, 4)).toBeNull();
  });
});

describe("openingRects", () => {
  it("turns wall metres from the bottom left into image pixels from the top left", () => {
    // A 1 x 2 m window 3 m from the left, its sill 1 m up, on a 10 m high wall at 10 px/m.
    expect(openingRects([{ x: 3, y: 1, width: 1, height: 2 }], 100, 10)).toEqual([
      { x0: 30, x1: 40, y0: 70, y1: 90 },
    ]);
  });
});
