import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomTextInput } from "@/components/shared/CustomTextInput";

describe("CustomTextInput", () => {
  it("commits on blur and Enter, ignores empty, reverts on Escape", () => {
    const onCommit = vi.fn();
    render(<CustomTextInput label="Name" value="Kitchen" onCommit={onCommit} />);
    const input = screen.getByLabelText<HTMLInputElement>("Name");
    fireEvent.change(input, { target: { value: "Bath" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("Bath");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("Kitchen");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("Kitchen");
  });

  it("follows an external value change", () => {
    const { rerender } = render(
      <CustomTextInput label="Name" value="A" onCommit={() => undefined} />,
    );
    rerender(<CustomTextInput label="Name" value="B" onCommit={() => undefined} />);
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("B");
  });
});
