/**
 * The facade survey of each building: the openings measured on every photographed wall, and
 * the facts the user confirmed. Kept in the browser (localStorage) so a reload loses nothing;
 * photos themselves are never stored, only the file name.
 */
import { create } from "zustand";
import type { AgeClassId } from "lod2-core/survey";
import type { Opening } from "lod2-core/openings";

export interface SurveyedWallRecord {
  partGid: string;
  surfaceIndex: number;
  /** In wall metres, origin bottom left, as the photo editor holds them. */
  openings: Opening[];
  photo?: string;
  method: "detected" | "drawn";
  /** Milliseconds since 1970, when the openings last changed. */
  updatedAt: number;
}

export interface SurveyFactsRecord {
  ageClass: AgeClassId;
  ageClassConfirmed: boolean;
  /** Typed storey count; missing means estimate it. */
  storeys?: number;
}

export interface BuildingSurvey {
  /** By wall key, `partGid:surfaceIndex`. */
  walls: Record<string, SurveyedWallRecord>;
  facts: SurveyFactsRecord;
}

interface SurveyState {
  buildings: Record<string, BuildingSurvey>;
  saveWall: (buildingGid: string, key: string, wall: SurveyedWallRecord) => void;
  removeWall: (buildingGid: string, key: string) => void;
  setFacts: (buildingGid: string, patch: Partial<SurveyFactsRecord>) => void;
  clearBuilding: (buildingGid: string) => void;
}

const STORAGE_KEY = "lod2.survey.v1";

export const DEFAULT_FACTS: SurveyFactsRecord = { ageClass: "bis1918", ageClassConfirmed: false };

function emptySurvey(): BuildingSurvey {
  return { walls: {}, facts: { ...DEFAULT_FACTS } };
}

function load(): Record<string, BuildingSurvey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, BuildingSurvey>)
      : {};
  } catch {
    // Unreadable or blocked storage starts an empty survey rather than breaking the app.
    return {};
  }
}

function save(buildings: Record<string, BuildingSurvey>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildings));
  } catch {
    // A full or blocked storage quota only means the survey is not kept over a reload.
  }
}

export const useSurvey = create<SurveyState>((set, get) => {
  const update = (buildingGid: string, change: (survey: BuildingSurvey) => BuildingSurvey) => {
    const current = get().buildings[buildingGid] ?? emptySurvey();
    const buildings = { ...get().buildings, [buildingGid]: change(current) };
    set({ buildings });
    save(buildings);
  };
  return {
    buildings: load(),
    saveWall: (buildingGid, key, wall) => {
      update(buildingGid, (s) => ({ ...s, walls: { ...s.walls, [key]: wall } }));
    },
    removeWall: (buildingGid, key) => {
      update(buildingGid, (s) => {
        const walls = Object.fromEntries(Object.entries(s.walls).filter(([k]) => k !== key));
        return { ...s, walls };
      });
    },
    setFacts: (buildingGid, patch) => {
      update(buildingGid, (s) => ({ ...s, facts: { ...s.facts, ...patch } }));
    },
    clearBuilding: (buildingGid) => {
      const buildings = Object.fromEntries(
        Object.entries(get().buildings).filter(([gid]) => gid !== buildingGid),
      );
      set({ buildings });
      save(buildings);
    },
  };
});

/** The survey of one building, or an empty one. Stable when nothing is stored. */
const EMPTY = emptySurvey();
export function surveyOf(
  buildings: Record<string, BuildingSurvey>,
  buildingGid: string | null | undefined,
): BuildingSurvey {
  return (buildingGid ? buildings[buildingGid] : undefined) ?? EMPTY;
}
