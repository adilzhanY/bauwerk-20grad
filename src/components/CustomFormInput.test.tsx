import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomFormInput } from "./CustomFormInput";

describe("CustomFormInput", () => {
  it("reports every keystroke and shows its error", () => {
    const onChange = vi.fn();
    render(<CustomFormInput label="Email" value="" onChange={onChange} error="Not right" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@" } });
    expect(onChange).toHaveBeenCalledWith("a@");
    expect(screen.getByText("Not right")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  it("hides a password until asked to show it", () => {
    render(
      <CustomFormInput label="Password" type="password" value="secret12" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("Password");
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.getAttribute("type")).toBe("password");
  });
});
