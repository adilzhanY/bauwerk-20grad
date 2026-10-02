import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { useEditorStore } from "@/store/building";
import { RightPanel } from "./RightPanel";

const house = exampleHouse("en");
const ground = house.storeys[0]!;
const room = ground.rooms[0]!;

beforeEach(() => {
  useEditorStore.getState().loadBuilding(house);
  useEditorStore.setState({ language: "en", projectId: null, selection: null });
});

describe("the notes in the right panel", () => {
  it("stay at its foot, apart from the properties, and follow what is picked", () => {
    render(<RightPanel />);
    const dock = screen.getByRole("region", { name: "Notes" });
    expect(dock.textContent).toContain("Notes on the building");
    act(() => {
      useEditorStore.getState().select({ kind: "room", storeyId: ground.id, id: room.id });
    });
    expect(screen.getByRole("region", { name: "Notes" }).textContent).toContain(
      `Notes on ${ground.name}, ${room.name}`,
    );
    // The box to write in belongs to the dock, not to the scrolling properties.
    expect(dock.querySelector("input, textarea")).toBeTruthy();
  });
});
