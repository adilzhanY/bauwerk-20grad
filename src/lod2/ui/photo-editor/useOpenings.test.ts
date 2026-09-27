import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WallPlane } from "lod2-core/wall";
import { useOpenings } from "./useOpenings.ts";

const wall = { width: 10, height: 6 } as WallPlane;
const box = { x: 1, y: 1, width: 1, height: 1.5 };

function setup() {
  return renderHook(() => useOpenings(wall, 60));
}

describe("useOpenings history", () => {
  it("undoes and redoes an add", () => {
    const { result } = setup();
    act(() => {
      result.current.add(box);
    });
    expect(result.current.list).toHaveLength(1);
    act(() => {
      result.current.undo();
    });
    expect(result.current.list).toHaveLength(0);
    expect(result.current.canRedo).toBe(true);
    act(() => {
      result.current.redo();
    });
    expect(result.current.list).toEqual([box]);
  });

  it("makes one drag one step, and a second drag another", () => {
    const { result } = setup();
    act(() => {
      result.current.add(box);
    });
    for (const x of [2, 3, 4])
      act(() => {
        result.current.update(0, { ...box, x }, "drag1");
      });
    for (const x of [5, 6])
      act(() => {
        result.current.update(0, { ...box, x }, "drag2");
      });
    act(() => {
      result.current.undo();
    });
    expect(result.current.list[0]?.x).toBe(4);
    act(() => {
      result.current.undo();
    });
    expect(result.current.list[0]?.x).toBe(1);
  });

  it("keeps updates without a key as separate steps and drops the redo branch on a new change", () => {
    const { result } = setup();
    act(() => {
      result.current.add(box);
    });
    act(() => {
      result.current.update(0, { ...box, x: 2 });
    });
    act(() => {
      result.current.update(0, { ...box, x: 3 });
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.list[0]?.x).toBe(2);
    act(() => {
      result.current.update(0, { ...box, x: 7 });
    });
    expect(result.current.canRedo).toBe(false);
  });

  it("forgets the history on clear, and an undo after detection returns to the empty wall", () => {
    const { result } = setup();
    act(() => {
      result.current.add(box);
    });
    // The detection flow clears and then replaces from a closure made before the clear.
    const stale = result.current;
    act(() => {
      result.current.clear();
    });
    act(() => {
      stale.replaceWithProposals([{ ...box, score: 0.9, kind: "window" }]);
    });
    expect(result.current.list).toHaveLength(1);
    act(() => {
      result.current.undo();
    });
    expect(result.current.list).toEqual([]);
    expect(result.current.canUndo).toBe(false);
  });

  it("drops a selection that no longer exists after undo", () => {
    const { result } = setup();
    act(() => {
      result.current.add(box);
    });
    expect(result.current.selected).toBe(0);
    act(() => {
      result.current.undo();
    });
    expect(result.current.selected).toBeNull();
  });
});
