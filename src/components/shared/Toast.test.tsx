import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("keeps its buttons on one line and lets the message wrap", () => {
    render(
      <Toast actions={<button type="button">Restore this version</button>}>
        Viewing version 8 from 2 Oct, 16:39, by Adil Yer. Changes here are not kept.
      </Toast>,
    );
    const actions = screen.getByRole("button", { name: "Restore this version" }).parentElement;
    expect(actions?.className).toContain("whitespace-nowrap");
    expect(actions?.className).toContain("shrink-0");
    expect(screen.getByText(/Changes here are not kept/).className).toContain("flex-1");
  });
});
