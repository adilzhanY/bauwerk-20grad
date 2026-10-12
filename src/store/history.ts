import type { StateCreator, StoreMutatorIdentifier } from "zustand";
import { can } from "@/projects/roles";
import type { Role } from "@/projects/roles";
import type { Building, Id } from "@/geometry/types";
import type { Selection } from "./building";
import { selectionExists } from "./selectors";

export const HISTORY_LIMIT = 200;

export interface HistorySlice {
  past: Building[];
  future: Building[];
  undo: () => void;
  redo: () => void;
  /** Runs `fn` without recording building changes. For applying remote state. */
  withoutHistory: (fn: () => void) => void;
  /**
   * Starts a gesture: every building change until the matching `endBatch` is one undo
   * step. Used by sliders and inputs that update the model live while the user drags or
   * types. Calls nest: only the outermost pair opens and closes the gesture. `hold` (the
   * default, for pointer drags) also holds back sending until the end; typing passes false,
   * so a typed value reaches the server at once. Pass the same `hold` to both.
   */
  beginBatch: (hold?: boolean) => void;
  endBatch: (hold?: boolean) => void;
  /** Whether a held gesture is open: the sync client sends its changes once it closes. */
  gesture: boolean;
  /**
   * Forgets every undo and redo step. When another project opens: undo must never bring back
   * the building of the project before.
   */
  clearHistory: () => void;
}

interface WithBuilding {
  building: Building;
  activeStoreyId: Id | null;
  activeZoneId: Id | null;
  selection: Selection | null;
  hovered: Selection | null;
  viewScenarioId: string | null;
}

/**
 * Undo and redo middleware. It watches the `building` slice only: whenever a
 * state update replaces `building` with a new reference, the previous one is
 * pushed onto `past` and `future` is cleared. UI state (selection, tool,
 * language, active storey) is never recorded. After a restore the active storey
 * and the selection are only clamped so they never point at an element the
 * restored building does not have.
 *
 * Buildings are immutable values (Immer produces fresh objects), so keeping
 * references is enough to restore an exact previous state.
 */
type History = <
  T extends WithBuilding,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  initializer: StateCreator<T, Mps, Mcs>,
) => StateCreator<T & HistorySlice, Mps, Mcs>;

type HistoryImpl = <T extends WithBuilding>(
  initializer: StateCreator<T>,
) => StateCreator<T & HistorySlice>;

/** UI references that must stay valid for `building`. Returns only the fields that change. */
export function clampUiState(
  building: Building,
  ui: Omit<WithBuilding, "building">,
): Partial<Omit<WithBuilding, "building">> {
  const patch: Partial<Omit<WithBuilding, "building">> = {};
  if (!building.storeys.some((s) => s.id === ui.activeStoreyId)) {
    patch.activeStoreyId = building.storeys[0]?.id ?? null;
  }
  if (!building.zones.some((z) => z.id === ui.activeZoneId)) patch.activeZoneId = null;
  if (ui.selection && !selectionExists(building, ui.selection)) patch.selection = null;
  if (ui.hovered && !selectionExists(building, ui.hovered)) patch.hovered = null;
  if (
    ui.viewScenarioId !== null &&
    ui.viewScenarioId !== "full-envelope" &&
    !building.scenarios?.some((scenario) => scenario.id === ui.viewScenarioId)
  ) {
    patch.viewScenarioId = null;
  }
  return patch;
}

const historyImpl: HistoryImpl = (initializer) => (set, get, api) => {
  type S = ReturnType<typeof initializer> & HistorySlice;
  let restoring = false;
  let batchDepth = 0;
  let batchRecorded = false;
  let holdDepth = 0;

  const trackedSet: typeof set = (partial, replace) => {
    const before = get().building;
    if (replace === true) {
      set(partial as Parameters<typeof set>[0], true);
    } else {
      set(partial);
    }
    const after = get().building;
    if (restoring || before === after) return;
    // A viewer or commenter of a server project changes nothing: the server would refuse it
    // anyway, so the change is taken back here before anyone sees it (projects/roles.ts).
    const role = (get() as { projectRole?: Role | null }).projectRole;
    if (role && !can(role, "edit")) {
      set({ building: before } as Partial<S>);
      return;
    }
    if (batchDepth > 0) {
      // Only the first change of a gesture records the snapshot taken before it.
      if (batchRecorded) return;
      batchRecorded = true;
    }
    set((state) => {
      const past = [...state.past, before];
      if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
      return { past, future: [] } as Partial<S>;
    });
  };

  const restore = (direction: "undo" | "redo") => {
    const state = get();
    const source = direction === "undo" ? state.past : state.future;
    const target = source[source.length - 1];
    if (target === undefined) return;
    restoring = true;
    try {
      const ui = clampUiState(target, state);
      set(
        (direction === "undo"
          ? {
              ...ui,
              building: target,
              past: source.slice(0, -1),
              future: [...state.future, state.building],
            }
          : {
              ...ui,
              building: target,
              future: source.slice(0, -1),
              past: [...state.past, state.building],
            }) as Partial<S>,
      );
    } finally {
      restoring = false;
    }
  };

  const base = initializer(trackedSet, get, api);
  return {
    ...base,
    past: [],
    future: [],
    gesture: false,
    undo: () => {
      restore("undo");
    },
    redo: () => {
      restore("redo");
    },
    beginBatch: (hold = true) => {
      batchDepth += 1;
      if (batchDepth === 1) batchRecorded = false;
      if (hold) holdDepth += 1;
      if (holdDepth === 1 && !get().gesture) set({ gesture: true } as Partial<S>);
    },
    endBatch: (hold = true) => {
      if (batchDepth === 0) return;
      batchDepth -= 1;
      if (hold && holdDepth > 0) holdDepth -= 1;
      if (batchDepth === 0) {
        batchRecorded = false;
        holdDepth = 0;
      }
      if (holdDepth === 0 && get().gesture) set({ gesture: false } as Partial<S>);
    },
    clearHistory: () => {
      // A gesture whose end never came (a handle gone mid drag) must not swallow every
      // later edit into one undo step.
      batchDepth = 0;
      batchRecorded = false;
      holdDepth = 0;
      set({ past: [], future: [], gesture: false } as unknown as Partial<S>);
    },
    withoutHistory: (fn) => {
      const previous = restoring;
      restoring = true;
      try {
        fn();
      } finally {
        restoring = previous;
      }
    },
  };
};

export const history = historyImpl as unknown as History;
