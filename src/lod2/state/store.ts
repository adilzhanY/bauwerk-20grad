import { create } from "zustand";
import { parseRoute } from "../../app/router";
import type { BuildingDetail, CoverageStats, Neighbour } from "lod2-core/api";
import { fetchBuilding, fetchNeighbours, fetchStats } from "../api/client.ts";

/**
 * Identifies one surface of one building part, for the session only.
 *
 * Index into `part.mesh.surfaces`, which is stable for as long as the loaded detail is, but
 * not across a re-ingest, since the source regenerates its surface ids on every data release.
 * Anything that has to outlive a reload needs an identity derived from the geometry instead.
 */
export interface WallRef {
  partGid: string;
  surfaceIndex: number;
}

export const wallKey = (w: WallRef): string => `${w.partGid}:${w.surfaceIndex}`;

export interface MapView {
  lon: number;
  lat: number;
  zoom: number;
}

/** Methfesselstraße, Berlin-Kreuzberg. */
const DEFAULT_VIEW: MapView = { lon: 13.3836, lat: 52.4864, zoom: 16.5 };

interface State {
  view: MapView;
  selectedGid: string | null;
  hoveredGid: string | null;
  building: BuildingDetail | null;
  neighbours: Neighbour[];
  showNeighbours: boolean;
  /** Drape orthophotos on roofs and the ground plane, instead of flat colours. */
  showAerial: boolean;
  /** Aerial imagery instead of the vector basemap on the 2D map. */
  aerialBasemap: boolean;
  loadingBuilding: boolean;
  /**
   * The neighbour fetch, tracked apart from the building's own.
   *
   * They are three orders of magnitude apart: the selected building is a few kilobytes and
   * nine surfaces, its 800 m surroundings are eight megabytes and twenty thousand. Reporting
   * them as one "loading" made the fast one wait on the slow one for no reason.
   */
  loadingNeighbours: boolean;
  /** Why the building could not be loaded: not in the data, or the request failed. */
  error: { kind: "notFound" } | { kind: "failed"; message: string } | null;
  stats: CoverageStats | null;
  /** Source tiles the API is currently fetching for us. */
  pendingTiles: number;
  /** Bumped when freshly ingested tiles are ready, to make the map refetch. */
  refreshToken: number;
  highlightedPlane: { gid: string; idx: number } | null;
  /** The wall the user clicked in the 3D view, if any. */
  selectedWall: WallRef | null;
  /** Whether the photo editor overlay is open. */
  photoEditorOpen: boolean;

  setView: (v: MapView) => void;
  setHovered: (gid: string | null) => void;
  select: (gid: string | null) => void;
  setPendingTiles: (n: number) => void;
  bumpRefresh: () => void;
  toggleNeighbours: () => void;
  toggleAerial: () => void;
  toggleAerialBasemap: () => void;
  selectWall: (wall: WallRef | null) => void;
  openPhotoEditor: () => void;
  closePhotoEditor: () => void;
  highlightPlane: (gid: string, idx: number) => void;
  clearHighlight: () => void;
  loadStats: () => Promise<void>;
}
/**
 * Read the initial view and selection out of the URL so links are shareable: the map view
 * from `?at=`, the building from the page path (`/gebaeude/<gid>`, see app/router.ts), with
 * the old `?gid=` still understood.
 */
function initialFromUrl(): { view: MapView; gid: string | null } {
  const p = new URLSearchParams(location.search);
  const route = parseRoute(location.pathname, import.meta.env.BASE_URL);
  const gid = route.page === "building" ? route.gid : p.get("gid");
  const at = p.get("at")?.split(",").map(Number) ?? [];
  const [lon, lat, zoom] = at;
  const view =
    at.length === 3 &&
    lon !== undefined &&
    lat !== undefined &&
    zoom !== undefined &&
    at.every(Number.isFinite)
      ? { lon, lat, zoom }
      : DEFAULT_VIEW;
  return { view, gid };
}

let detailRun = 0;

export const useStore = create<State>((set, get) => {
  const { view, gid } = initialFromUrl();

  const syncUrl = () => {
    const { view: v } = get();
    // Only the map view lives in the query; the building is in the path, owned by the router.
    const p = new URLSearchParams(location.search);
    p.delete("gid");
    p.set("at", `${v.lon.toFixed(5)},${v.lat.toFixed(5)},${v.zoom.toFixed(1)}`);
    history.replaceState(null, "", `${location.pathname}?${p}`);
  };

  const loadDetail = async (buildingGid: string | null) => {
    const run = ++detailRun;
    if (!buildingGid) {
      set({
        building: null,
        neighbours: [],
        loadingBuilding: false,
        loadingNeighbours: false,
        error: null,
      });
      return;
    }
    // Clear the previous building and its surroundings up front. Leaving them on screen while
    // the new one loads lets a wall of the old building be picked for the new one.
    set({
      building: null,
      loadingBuilding: true,
      loadingNeighbours: false,
      neighbours: [],
      error: null,
    });
    try {
      const building = await fetchBuilding(buildingGid);
      if (run !== detailRun) return; // a newer selection won
      if (!building) {
        set({
          building: null,
          neighbours: [],
          loadingBuilding: false,
          loadingNeighbours: false,
          error: { kind: "notFound" },
        });
        return;
      }
      // Published on its own, so the scene can draw the building before the 8 MB of context
      // it sits in has even been asked for.
      set({ building, loadingBuilding: false });

      if (!get().showNeighbours) return;
      set({ loadingNeighbours: true });
      try {
        const near = await fetchNeighbours(buildingGid);
        if (run === detailRun) set({ neighbours: near, loadingNeighbours: false });
      } catch (err) {
        // Context is optional; the building stays usable without it.
        if (run === detailRun) set({ loadingNeighbours: false });
        console.warn("neighbours failed:", (err as Error).message);
      }
    } catch (err) {
      if (run !== detailRun) return;
      set({
        building: null,
        loadingBuilding: false,
        loadingNeighbours: false,
        error: { kind: "failed", message: (err as Error).message },
      });
    }
  };

  if (gid) void loadDetail(gid);

  return {
    view,
    selectedGid: gid,
    hoveredGid: null,
    building: null,
    neighbours: [],
    showNeighbours: true,
    showAerial: true,
    aerialBasemap: false,
    loadingBuilding: Boolean(gid),
    loadingNeighbours: false,
    error: null,
    stats: null,
    pendingTiles: 0,
    refreshToken: 0,
    highlightedPlane: null,
    selectedWall: null,
    photoEditorOpen: false,

    setView: (v) => {
      set({ view: v });
      syncUrl();
    },
    setHovered: (hoveredGid) => {
      set({ hoveredGid });
    },
    select: (selectedGid) => {
      set({ selectedGid, highlightedPlane: null, selectedWall: null, photoEditorOpen: false });
      syncUrl();
      void loadDetail(selectedGid);
    },
    /**
     * Only publish a change when the number actually changed.
     *
     * `usePendingPoll` calls this every 2.5 seconds, and almost every call carries the same
     * value. Writing it regardless made every subscriber re-render on a timer, harmless on
     * its own, and not harmless at all next to a one-second scene build: while that lived in
     * a concurrent render, each tick interrupted and restarted it, so it never finished. The
     * build has moved to an effect (`useSceneContext`) and is no longer interruptible, but a
     * store that notifies when nothing changed is a bug in its own right.
     */
    setPendingTiles: (pendingTiles) => {
      if (get().pendingTiles !== pendingTiles) set({ pendingTiles });
    },
    bumpRefresh: () => {
      set({ refreshToken: get().refreshToken + 1 });
    },
    toggleAerial: () => {
      set({ showAerial: !get().showAerial });
    },
    toggleAerialBasemap: () => {
      set({ aerialBasemap: !get().aerialBasemap });
    },
    toggleNeighbours: () => {
      const next = !get().showNeighbours;
      set({ showNeighbours: next });
      void loadDetail(get().selectedGid);
    },
    // The only place the selected wall is set: part id plus surface index, nothing else.
    selectWall: (selectedWall) => {
      set({ selectedWall });
    },
    openPhotoEditor: () => {
      set({ photoEditorOpen: true });
    },
    closePhotoEditor: () => {
      set({ photoEditorOpen: false });
    },
    highlightPlane: (gid, idx) => {
      set({ highlightedPlane: { gid, idx } });
    },
    clearHighlight: () => {
      set({ highlightedPlane: null });
    },
    loadStats: async () => {
      try {
        set({ stats: await fetchStats() });
      } catch {
        /* stats are decoration; a failure must not break the map */
      }
    },
  };
});
