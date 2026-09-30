import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CustomSlider } from "@/components/shared/CustomSlider";
import { snapToStep } from "@/components/shared/snap";

function Harness({
  onGestureStart,
  onGestureEnd,
}: {
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}) {
  const [v, setV] = useState(0.3);
  return (
    <CustomSlider
      label="Thickness"
      value={v}
      min={0.1}
      max={1}
      step={0.05}
      onChange={setV}
      onGestureStart={onGestureStart}
      onGestureEnd={onGestureEnd}
      format={(x) => `${x} m`}
    />
  );
}

describe("snapToStep", () => {
  it("clamps and snaps", () => {
    expect(snapToStep(0.33, 0.1, 1, 0.05)).toBe(0.35);
    expect(snapToStep(-3, 0.1, 1, 0.05)).toBe(0.1);
    expect(snapToStep(7, 0.1, 1, 0.05)).toBe(1);
    expect(snapToStep(2.5, 2, 6, 0.1)).toBe(2.5);
  });
});

describe("CustomSlider", () => {
  it("exposes the slider role with its range and value text", () => {
    render(<Harness />);
    const s = screen.getByRole("slider", { name: "Thickness" });
    expect(s.getAttribute("aria-valuemin")).toBe("0.1");
    expect(s.getAttribute("aria-valuemax")).toBe("1");
    expect(s.getAttribute("aria-valuenow")).toBe("0.3");
    expect(s.getAttribute("aria-valuetext")).toBe("0.3 m");
  });

  it("steps with the keyboard, ten steps with Shift, Home and End jump, clamped", () => {
    const start = vi.fn();
    const end = vi.fn();
    render(<Harness onGestureStart={start} onGestureEnd={end} />);
    const s = screen.getByRole("slider");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s.getAttribute("aria-valuenow")).toBe("0.35");
    fireEvent.keyDown(s, { key: "ArrowLeft", shiftKey: true });
    expect(s.getAttribute("aria-valuenow")).toBe("0.1");
    fireEvent.keyDown(s, { key: "End" });
    expect(s.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(s.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.keyDown(s, { key: "Home" });
    expect(s.getAttribute("aria-valuenow")).toBe("0.1");
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(s, { key: "Home" });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("maps a pointer position along the track to a value and batches the drag", () => {
    const start = vi.fn();
    const end = vi.fn();
    render(<Harness onGestureStart={start} onGestureEnd={end} />);
    const s = screen.getByRole("slider");
    s.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      height: 32,
      right: 300,
      bottom: 32,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    s.setPointerCapture = vi.fn();
    s.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(s, { clientX: 200, button: 0, pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("0.55");
    expect(s.getAttribute("data-active")).toBe("true");
    fireEvent.pointerMove(s, { clientX: 300, pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("1");
    fireEvent.pointerMove(s, { clientX: -50, pointerId: 1 });
    expect(s.getAttribute("aria-valuenow")).toBe("0.1");
    fireEvent.pointerUp(s, { clientX: -50, pointerId: 1 });
    expect(s.getAttribute("data-active")).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("ignores input when disabled", () => {
    const onChange = vi.fn();
    render(
      <CustomSlider
        label="x"
        value={0.5}
        min={0}
        max={1}
        step={0.1}
        disabled
        onChange={onChange}
      />,
    );
    const s = screen.getByRole("slider");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    expect(s.getAttribute("aria-disabled")).toBe("true");
    expect(s.getAttribute("tabindex")).toBe("-1");
  });
});
