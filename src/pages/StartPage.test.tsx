import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "@/app/router";
import { StartPage } from "./StartPage";

// The map needs WebGL, which jsdom does not have.
vi.mock("@/components/shared/BuildingMap", () => ({ BuildingMap: () => null }));

describe("StartPage", () => {
  it("offers the example buildings while the search is empty and opens one", () => {
    const navigate = vi.fn();
    useRouter.setState({ navigate });
    render(<StartPage />);
    expect(screen.getByText("Methfesselstraße 8")).toBeTruthy();
    expect(screen.getByText("Methfesselstraße 6")).toBeTruthy();
    expect(screen.getByText("Methfesselstraße 27")).toBeTruthy();
    fireEvent.click(screen.getByText("Methfesselstraße 4"));
    expect(navigate).toHaveBeenCalledWith({ page: "building", gid: "DEBE02YY400001Vh" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Oranienstraße" } });
    expect(screen.queryByText("Methfesselstraße 8")).toBeNull();
  });
});
