import { beforeEach, describe, expect, it } from "vitest";
import { exampleHouse } from "@/lib/examples";
import { resetIds } from "@/lib/ids";
import { createEditorStore } from "@/store/building";
import { checkBuildingShape } from "./export";
import { notesAbout, pinPosition, sameTarget, targetExists } from "./notes";
import type { Building, NoteTarget } from "./types";

let b: Building;
beforeEach(() => {
  resetIds();
  b = exampleHouse("en");
});

const ground = () =>
  b.storeys[0] ??
  (() => {
    throw new Error("fixture");
  })();

describe("note targets", () => {
  it("match only the same element", () => {
    const window1: NoteTarget = { kind: "opening", storeyId: "s", id: "o1" };
    expect(sameTarget(window1, { kind: "opening", storeyId: "s", id: "o1" })).toBe(true);
    expect(sameTarget(window1, { kind: "opening", storeyId: "s", id: "o2" })).toBe(false);
    expect(sameTarget(window1, { kind: "room", storeyId: "s", id: "o1" })).toBe(false);
    expect(sameTarget({ kind: "wall", wallIndex: 1 }, { kind: "wall", wallIndex: 1 })).toBe(true);
  });

  it("keep a note whose window was deleted, with the building", () => {
    const o = ground().openings[0];
    if (!o) throw new Error("fixture");
    const target: NoteTarget = { kind: "opening", storeyId: ground().id, id: o.id };
    const note = {
      id: "n1",
      target,
      text: "leaks",
      author: "Ada",
      createdAt: "2026-09-28T10:00:00Z",
    };
    const gone: Building = {
      ...b,
      notes: [note],
      storeys: b.storeys.map((s, i) => (i === 0 ? { ...s, openings: s.openings.slice(1) } : s)),
    };
    expect(targetExists(gone, target)).toBe(false);
    expect(notesAbout(gone, { kind: "building" })).toEqual([note]);
    expect(pinPosition(gone, target)).toBeNull();
  });
});

describe("pinPosition", () => {
  it("puts a window's pin just outside its facade, above the window", () => {
    const o = ground().openings.find((x) => !x.interior && x.wallIndex === 0);
    if (!o) throw new Error("fixture");
    const pin = pinPosition(b, { kind: "opening", storeyId: ground().id, id: o.id });
    // Wall 0 runs along y = 0 and faces south (-y): the pin is in front of it.
    expect(pin?.point.x).toBeCloseTo(o.offset + o.width / 2);
    expect(pin?.point.y).toBeLessThan(0);
    expect(pin?.height).toBeCloseTo(o.sill + o.height + 0.3);
  });

  it("stands above the roof for the building and on the floor plan for a room", () => {
    const eaves = b.storeys.reduce((s, x) => s + x.height, 0);
    expect(pinPosition(b, { kind: "building" })?.height).toBeCloseTo(eaves + 1.5);
    const room = ground().rooms[0];
    if (!room) throw new Error("fixture");
    expect(
      pinPosition(b, { kind: "room", storeyId: ground().id, id: room.id })?.height,
    ).toBeCloseTo(1.2);
  });
});

describe("notes in the store", () => {
  it("add, mark done and remove, each one undo step", () => {
    const store = createEditorStore();
    const s = () => store.getState();
    s().loadBuilding(b);
    const before = s().building;
    const id = s().addNote({ kind: "wall", wallIndex: 2 }, "  Feuchte unten links  ", "Ada");
    expect(s().building.notes?.[0]).toMatchObject({
      id,
      text: "Feuchte unten links",
      author: "Ada",
    });
    s().setNoteDone(id, true);
    expect(s().building.notes?.[0]?.done).toBe(true);
    s().setNoteDone(id, false);
    expect(s().building.notes?.[0] && "done" in s().building.notes![0]!).toBe(false);
    s().removeNote(id);
    expect(s().building.notes).toEqual([]);
    for (let i = 0; i < 4; i++) s().undo();
    expect(s().building).toBe(before);
  });

  it("are checked when a building comes from outside", () => {
    const note = {
      id: "n",
      target: { kind: "wall", wallIndex: 0 },
      text: "ok",
      author: "A",
      createdAt: "x",
    };
    expect(checkBuildingShape({ ...b, notes: [note] }, "building")).toBeNull();
    expect(
      checkBuildingShape({ ...b, notes: [{ ...note, target: { kind: "roof" } }] }, "building"),
    ).not.toBeNull();
    expect(checkBuildingShape({ ...b, notes: [{ ...note, text: 5 }] }, "building")).not.toBeNull();
  });
});
