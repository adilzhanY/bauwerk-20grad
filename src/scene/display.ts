import type { Building } from "@/geometry/types";

export type StoreyDisplay = "solid" | "ghost" | "outline" | "hidden";

import type { OtherStoreys } from "@/store/building";

/**
 * How a storey is drawn given the active one. The active storey is always solid;
 * storeys above it default to outlines so they stop hiding the floor being edited
 * (Revit calls this a halftone underlay, ArchiCAD a ghost story), storeys below
 * default to a faint ghost so the building still reads as a whole.
 */
/**
 * Whether the roof is drawn solid over the storeys: set so, or selected (a selected roof is
 * always solid). Storeys above the active one are at most a ghost. Room labels are HTML over
 * the canvas and would show through a solid roof, so they stay hidden then.
 */
export function coveredFromAbove(other: OtherStoreys, roofSelected: boolean): boolean {
  return roofSelected || other.roof === "solid";
}

export function storeyDisplay(
  building: Building,
  storeyId: string,
  activeStoreyId: string | null,
  other: OtherStoreys,
): StoreyDisplay {
  if (storeyId === activeStoreyId || activeStoreyId === null) return "solid";
  const index = building.storeys.findIndex((s) => s.id === storeyId);
  const activeIndex = building.storeys.findIndex((s) => s.id === activeStoreyId);
  if (index === -1 || activeIndex === -1) return "solid";
  return index > activeIndex ? other.above : other.below;
}
