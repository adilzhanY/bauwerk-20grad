import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { useEditorStore } from "@/store/building";
import { NotesSection } from "@/components/editor/NotesSection";

beforeEach(() => {
  resetIds();
  useEditorStore.setState({ language: "en", projectId: null });
  useEditorStore.getState().loadBuilding(exampleHouse("en"));
});

describe("notes on an element", () => {
  it("adds a note with Enter, signed and timed, and marks it done", () => {
    const target = { kind: "wall" as const, wallIndex: 1 };
    render(<NotesSection target={target} />);
    const field = screen.getByLabelText("Add a note, then Enter");
    field.focus();
    fireEvent.change(field, { target: { value: "Crack above the cellar window" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Crack above the cellar window")).toBeTruthy();
    expect(screen.getByText(/^Me · /)).toBeTruthy();
    const notes = useEditorStore.getState().building.notes ?? [];
    expect(notes).toHaveLength(1);
    expect(notes[0]?.target).toEqual(target);
    // The field is empty again for the next note.
    expect(screen.getByLabelText<HTMLInputElement>("Add a note, then Enter").value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Mark as done" }));
    expect(useEditorStore.getState().building.notes?.[0]?.done).toBe(true);
    expect(screen.getByRole("button", { name: "Open again" })).toBeTruthy();
  });

  it("does not add an empty note", () => {
    render(<NotesSection target={{ kind: "building" }} />);
    const field = screen.getByLabelText("Add a note, then Enter");
    field.focus();
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(useEditorStore.getState().building.notes ?? []).toHaveLength(0);
  });
});
