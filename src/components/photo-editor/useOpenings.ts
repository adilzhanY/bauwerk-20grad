import { useMemo, useRef, useState } from "react";
import type { VisionOpening } from "lod2-core/api";
import {
  clampOpening,
  defaultOpening,
  duplicateOpening,
  openingCenteredAt,
  openingsSummary,
  type Opening,
  type OpeningsSummary,
} from "lod2-core/openings";
import type { Point2 } from "lod2-core/photo";
import type { WallPlane } from "lod2-core/wall";
import { DUPLICATE_GAP_M, OPENINGS_HISTORY_LIMIT } from "@/components/photo-editor/constants";

/** The openings drawn on one wall, the selected one, and every edit the editor offers. */
export interface OpeningsState {
  list: Opening[];
  selected: number | null;
  /** The selected opening itself, or null. */
  current: Opening | null;
  summary: OpeningsSummary;
  canUndo: boolean;
  canRedo: boolean;
  select: (index: number | null) => void;
  add: (opening: Opening) => void;
  addDefault: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  copySelected: () => void;
  paste: (point: Point2 | null) => void;
  /**
   * Change one opening. Consecutive updates with the same `merge` key are one undo step:
   * a drag passes one key per gesture, a number field one key per field.
   */
  update: (index: number, next: Opening, merge?: string) => void;
  /** Replace everything with the detector's proposals, each kept inside the wall. */
  replaceWithProposals: (proposals: VisionOpening[]) => void;
  undo: () => void;
  redo: () => void;
  /** Empty the wall and forget its history, for a new photo. */
  clear: () => void;
}

/**
 * Openings state for the wall editor. All positions are wall metres, origin bottom left,
 * and every change is clamped to the wall so no box can leave it. Every change to the list
 * is one undo step; the selection and the clipboard are not part of the history.
 */
export function useOpenings(wall: WallPlane | null, wallArea: number): OpeningsState {
  const [list, setList] = useState<Opening[]>([]);
  const [past, setPast] = useState<Opening[][]>([]);
  const [future, setFuture] = useState<Opening[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  /** The opening copied with Ctrl+C. Editor memory only, never the system clipboard. */
  const [clipboard, setClipboard] = useState<Opening | null>(null);
  /** Merge key of the last recorded change, so a drag or a typed number stays one step. */
  const lastMerge = useRef<string | null>(null);
  /**
   * The newest list, ahead of the render. Detection resolves in a closure made renders ago,
   * and pointer moves can come faster than renders, so every change starts from this.
   */
  const latest = useRef<Opening[]>(list);
  const show = (next: Opening[]) => {
    latest.current = next;
    setList(next);
  };
  // Count, opening area, and the window-to-wall ratio. The wall area comes from the model
  // polygon above ground, so only the drawn boxes carry a measuring error.
  const summary = useMemo(() => openingsSummary(list, wallArea), [list, wallArea]);
  const current = selected === null ? null : (list[selected] ?? null);

  /** Record the list as it is now, unless this change continues the last one. */
  const record = (merge: string | null) => {
    if (merge === null || merge !== lastMerge.current) {
      const before = latest.current;
      setPast((p) => [...p, before].slice(-OPENINGS_HISTORY_LIMIT));
    }
    setFuture([]);
    lastMerge.current = merge;
  };

  const commit = (next: Opening[]) => {
    record(null);
    show(next);
  };

  const add = (opening: Opening) => {
    const index = latest.current.length;
    commit([...latest.current, opening]);
    setSelected(index);
  };

  const addDefault = () => {
    if (wall) add(defaultOpening(wall.width, wall.height));
  };

  /** Add the opening when there is one; a copy with no free place on the wall is null. */
  const addIfAny = (opening: Opening | null) => {
    if (opening) add(opening);
  };

  const duplicateSelected = () => {
    if (wall && current)
      addIfAny(duplicateOpening(current, DUPLICATE_GAP_M, wall.width, wall.height));
  };

  const deleteSelected = () => {
    if (selected === null) return;
    commit(latest.current.filter((_, index) => index !== selected));
    setSelected(null);
  };

  const copySelected = () => {
    if (current) setClipboard(current);
  };

  /** Paste under the mouse when it is over the wall, otherwise next to the copied opening. */
  const paste = (point: Point2 | null) => {
    if (!clipboard || !wall) return;
    const pasted = point
      ? openingCenteredAt(clipboard, point, wall.width, wall.height)
      : duplicateOpening(clipboard, DUPLICATE_GAP_M, wall.width, wall.height);
    addIfAny(pasted);
  };

  const update = (index: number, next: Opening, merge?: string) => {
    if (!wall) return;
    // A box the user has moved or resized is theirs now, so it drops the detector's score;
    // whether it is a window or a door stays.
    const { x, y, width, height, kind } = next;
    const clamped = clampOpening(
      kind ? { x, y, width, height, kind } : { x, y, width, height },
      wall.width,
      wall.height,
    );
    record(merge === undefined ? null : `${merge}:${index}`);
    show(latest.current.map((o, i) => (i === index ? clamped : o)));
  };

  const replaceWithProposals = (proposals: VisionOpening[]) => {
    if (!wall) return;
    commit(
      proposals.map((o) =>
        clampOpening(
          { x: o.x, y: o.y, width: o.width, height: o.height, score: o.score, kind: o.kind },
          wall.width,
          wall.height,
        ),
      ),
    );
    setSelected(null);
  };

  /** Show a list from the history, keeping the selection when that opening still exists. */
  const restore = (next: Opening[]) => {
    show(next);
    lastMerge.current = null;
    if (selected !== null && selected >= next.length) setSelected(null);
  };

  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast(past.slice(0, -1));
    setFuture([latest.current, ...future]);
    restore(previous);
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast([...past, latest.current]);
    restore(next);
  };

  const clear = () => {
    show([]);
    setPast([]);
    setFuture([]);
    lastMerge.current = null;
    setSelected(null);
    setClipboard(null);
  };

  return {
    list,
    selected,
    current,
    summary,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    select: setSelected,
    add,
    addDefault,
    duplicateSelected,
    deleteSelected,
    copySelected,
    paste,
    update,
    replaceWithProposals,
    undo,
    redo,
    clear,
  };
}
