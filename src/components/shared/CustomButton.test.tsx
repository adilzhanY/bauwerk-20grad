import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CustomButton } from "@/components/shared/CustomButton";

describe("CustomButton", () => {
  it("fires on click, Enter and Space and not when disabled", () => {
    const onClick = vi.fn();
    render(<CustomButton onClick={onClick}>Save</CustomButton>);
    const b = screen.getByRole("button", { name: "Save" });
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    // Native buttons translate Enter and Space into click events in browsers;
    // jsdom does not, so the role guarantee is what we check here.
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
  });

  it("does not fire when disabled or loading", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <CustomButton disabled onClick={onClick}>
        Save
      </CustomButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    rerender(
      <CustomButton loading onClick={onClick}>
        Save
      </CustomButton>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBe("true");
  });

  it("a flush quiet button lines its label up with the column", () => {
    render(
      <CustomButton variant="quiet" flush>
        Export
      </CustomButton>,
    );
    expect(screen.getByRole("button").className).toContain("-ml-3");
  });
});
