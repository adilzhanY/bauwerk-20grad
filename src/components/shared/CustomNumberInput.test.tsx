import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";

function Harness(props: { start?: () => void; end?: () => void; slider?: boolean }) {
  const [v, setV] = useState(0.3);
  return (
    <CustomNumberInput
      label="Thickness"
      value={v}
      min={0.1}
      max={1}
      step={0.05}
      unit="m"
      language="de"
      slider={props.slider ?? false}
      onChange={setV}
      onGestureStart={props.start}
      onGestureEnd={props.end}
    />
  );
}

const field = () => screen.getByLabelText("Thickness", { selector: "input" });

describe("CustomNumberInput", () => {
  it("shows the value in the locale and commits typing live within range", () => {
    render(<Harness />);
    const input = field() as HTMLInputElement;
    expect(input.value).toBe("0,3");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0,4" } });
    expect(input.value).toBe("0,4");
    fireEvent.change(input, { target: { value: "0,45" } });
    fireEvent.blur(input);
    expect(input.value).toBe("0,45");
  });

  it("does not commit an out of range value while typing, blur clamps and snaps", () => {
    render(<Harness />);
    const input = field() as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "7" } });
    expect(input.value).toBe("7"); // draft stays, value did not move
    fireEvent.blur(input);
    expect(input.value).toBe("1"); // clamped to max
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0.33" } });
    fireEvent.blur(input);
    expect(input.value).toBe("0,35"); // snapped to step
  });

  it("Escape reverts and Enter commits, arrows step", () => {
    render(<Harness />);
    const input = field() as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0,9" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(input.value).toBe("0,3");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("0,25");
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(input.value).toBe("0,75");
    fireEvent.keyDown(input, { key: "Enter" });
  });

  it("preserves values whose step needs six decimal places", () => {
    const onChange = vi.fn();
    render(
      <CustomNumberInput
        label="Latitude"
        value={52.520008}
        min={-90}
        max={90}
        step={0.000001}
        language="en"
        slider={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Latitude");
    expect(input.value).toBe("52.520008");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(input.value).toBe("52.520008");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("scrubbing on the label changes the value by pixels moved, one gesture", () => {
    const start = vi.fn();
    const end = vi.fn();
    render(<Harness start={start} end={end} />);
    const label = screen.getByText("Thickness");
    label.setPointerCapture = vi.fn();
    label.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(label, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(label, { clientX: 140, pointerId: 1 }); // 40 px = 5 steps
    expect((field() as HTMLInputElement).value).toBe("0,55");
    fireEvent.pointerMove(label, { clientX: 60, pointerId: 1 }); // -40 px = -5 steps
    expect((field() as HTMLInputElement).value).toBe("0,1"); // clamped at min
    fireEvent.pointerUp(label, { clientX: 60, pointerId: 1 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("renders a slider that shares the value when asked", () => {
    render(<Harness slider />);
    const slider = screen.getByRole("slider", { name: "Thickness" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect((field() as HTMLInputElement).value).toBe("0,35");
    expect(slider.getAttribute("aria-valuetext")).toBe("0,35 m");
  });
});
