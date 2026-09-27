import { create } from "zustand";

/**
 * The compass bearing the camera looks along, for the minimap. Its own tiny store because it
 * changes while the camera moves, and nothing else should re-render when it does.
 */
export const useCameraHeading = create<{ bearing: number }>(() => ({ bearing: 225 }));
