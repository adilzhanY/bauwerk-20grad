import { shareActivity } from "@/sync/activity";
import { normalizeWalls } from "@/geometry/wallGraph";
import { can } from "@/projects/roles";
import type { Role } from "@/projects/roles";
import { create } from "zustand";
import { asOpening } from "@/geometry/floorPlanImport";
import { nameForRoom } from "@/geometry/roomNames";
import type { FloorPlanEdits } from "@/geometry/floorPlanImport";
import {
  placeAfterSplit,
  remapEdgeIndex,
  sharedAfterRemove,
  sharedAfterSplit,
} from "@/geometry/shared";
import type { EdgeChange } from "@/geometry/shared";
import { planToLatLon } from "@/geometry/geo";
import { resizeRectangle } from "@/geometry/box";
import { buildingCentre, rotateBuilding, translateBuilding } from "@/geometry/transform";
import { immer } from "zustand/middleware/immer";
import type {
  Building,
  GeoOrigin,
  Construction,
  HeatPump,
  Id,
  InteriorWall,
  Layer,
  Opening,
  Radiator,
  Roof,
  Scenario,
  Segment,
  Storey,
  Vec2,
  Zone,
  Economics,
  HeatingSystem,
  NoteTarget,
  ProjectInfo,
} from "@/geometry/types";
import { heatingOf } from "@/geometry/supply";
import { windowConstruction, windowType } from "@/geometry/windows";
import type { DragPreview } from "@/sync/presence";
import {
  DEFAULT_STOREY_HEIGHT,
  DEFAULT_WALL_THICKNESS,
  HEATED_TEMPERATURE,
  UNHEATED_TEMPERATURE,
} from "@/geometry/types";
import {
  DEFAULT_ASSIGNMENT,
  defaultConstructions,
  withInteriorWallTypes,
} from "@/geometry/constructions";
import { AGE_IDS, ageConstructions } from "@/geometry/ageDefaults";
import type { AgeChoice } from "@/geometry/ageDefaults";
import { uValueFromLayers } from "@/geometry/layers";
import { roofOf } from "@/geometry/roof";
import { ensureCounterClockwise, isCounterClockwise, isSimplePolygon } from "@/geometry/polygon";
import { computeRooms } from "@/geometry/rooms";
import { defaultRoomName, defaultStoreyName, detectLanguage } from "@/i18n";
import { localizeBuilding } from "@/i18n/localizeBuilding";
import { initialBuilding, loadLanguage, loadTheme } from "@/lib/storage";
import type { Language } from "@/i18n";
import { createId } from "@/lib/ids";
import { clampUiState, history } from "./history";
import type { HistorySlice } from "./history";

export type Theme = "light" | "dark" | "system";

/** The editor's tools. Window and door are two tools, so each is one click. */
export type Tool =
  "select" | "interiorWall" | "window" | "door" | "measure" | "footprint" | "zone" | "hvac";

/** The tools that change nothing, all a viewer or commenter gets (TODO Part 21, CB). */
export const LOOK_TOOLS: readonly Tool[] = ["select", "measure"];

/** Every tool for an editor or a project not on the server; only looking for the rest. */
export function toolAllowed(tool: Tool, role: Role | null): boolean {
  return role === null || can(role, "edit") || LOOK_TOOLS.includes(tool);
}

export type Selection =
  | { kind: "vertex"; index: number }
  | { kind: "wall"; storeyId: Id; wallIndex: number }
  | { kind: "opening"; storeyId: Id; id: Id }
  | { kind: "interiorWall"; storeyId: Id; index: number }
  | { kind: "room"; storeyId: Id; id: Id }
  | { kind: "storey"; id: Id }
  | { kind: "zone"; id: Id }
  | { kind: "roof" }
  | { kind: "radiator"; storeyId: Id; id: Id }
  | { kind: "heatPump"; id: Id }
  | { kind: "pipe"; storeyId: Id; id: Id }
  | { kind: "measurement"; storeyId: Id; id: Id };

/**
 * The camera views of the view switch: the free 3D view, straight down from the top, and the
 * four elevations, each looking at the facade that faces that compass direction.
 */
export type CameraView = "3d" | "top" | "n" | "e" | "s" | "w";

/** Display of storeys that are not being edited. */
export interface OtherStoreys {
  above: "hidden" | "outline" | "ghost";
  below: "outline" | "ghost" | "solid";
  roof: "hidden" | "outline" | "ghost" | "solid";
  ghostOpacity: number;
}

export interface EditorState {
  building: Building;
  activeStoreyId: Id | null;
  selection: Selection | null;
  /** Throttled hover target from the viewport. UI state, never in history. */
  hovered: Selection | null;
  /** A footprint edge lit on every storey while its row in the tree is hovered. UI state. */
  highlightedWall: number | null;
  tool: Tool;
  language: Language;
  showGrid: boolean;
  /** Zone the zone tool paints with. UI state. */
  activeZoneId: Id | null;
  /** Energy panel shows the renovated scenario. UI state. */
  renovatedView: boolean;
  /** Scenario shown in the Energy tab: null is the current state, "full-envelope" the built-in variant, else a saved id. UI state. */
  viewScenarioId: string | null;
  /** Other people editing the same project, from the sync layer. UI state. */
  presence: Presence[];
  /** An old version shown read only, from the history panel. */
  historyPreview: HistoryPreview | null;
  /** The footprint edge whose facade is open in the photo editor, or null. */
  photoWall: number | null;
  /**
   * Straightened facade photos by footprint edge, drawn on the walls in 3D. Only for this
   * browser session: an image is not part of the building and is not shared.
   */
  facadePhotos: Record<number, FacadePhoto>;
  /**
   * The floor plan image each storey was read from, by storey id: kept with the project like
   * the facade photos. UI state, not part of the building file.
   */
  floorPlanImages: Record<string, FacadePhoto>;
  showFacadePhotos: boolean;
  /** 0 shows the facade photos fully, 100 hides them. Percent, for all photos. */
  facadePhotoTransparency: number;
  /** Project id on the server when sync is active. UI state. */
  projectId: string | null;
  /**
   * This person's role in the open server project (projects/roles.ts), from the server on
   * joining; null without one. The editor shows only the tools the role may use. UI state.
   */
  projectRole: Role | null;
  /** The tab whose camera this view follows (TODO Part 21, CC.5), or null. UI state. */
  following: string | null;
  /** When this person last had the open server project open, before now (CG.4). UI state. */
  lastSeenAt: string | null;
  /** Orthographic top-down view of the active storey. UI state. */
  planView: boolean;
  /**
   * Set when a floor plan read by the AI was applied to a storey: the plan view plays its
   * reveal once, from `startedAt` (performance.now()), then clears it. UI state.
   */
  planReveal: { storeyId: Id; startedAt: number } | null;
  /** Floor plan image on the ground. Local to this browser, never exported. UI state. */
  underlay: Underlay | null;
  /** Result of the measure tool. UI state. */
  measurement: { a: Vec2; b: Vec2 } | null;
  theme: Theme;
  /** Red lines for thermal bridges. UI state. */
  showBridges: boolean;
  /** How storeys other than the active one are drawn. UI state. */
  otherStoreys: OtherStoreys;
  /** OpenStreetMap tiles on the ground when a location is set. UI state. */
  showMap: boolean;
  mapOpacity: number;
  /** The last view chosen in the view switch. `nonce` changes on every choice, so choosing the same view again moves the camera back to it. UI state. */
  cameraView: { view: CameraView; nonce: number };
  /** Storeys hidden with the eye in the layers panel. UI state. */
  hiddenStoreys: Id[];
}

export interface Underlay {
  url: string;
  /** Image width in metres on the ground. */
  widthMetres: number;
  /** Image aspect ratio height / width. */
  aspect: number;
  /** Plan position of the image centre. */
  x: number;
  y: number;
  opacity: number;
}

/** Which windows a window type change reaches. */
export type WindowScope =
  | { kind: "opening"; storeyId: Id; id: Id }
  | { kind: "wall"; wallIndex: number }
  | { kind: "storey"; storeyId: Id }
  | { kind: "building" };

/** A straightened facade photo: an object URL of the image and its size in pixels. */
export interface FacadePhoto {
  url: string;
  width: number;
  height: number;
}

/** An old version of a shared project on screen instead of the live building. */
export interface HistoryPreview {
  version: number;
  actor: string;
  createdAt: string;
}

export interface Presence {
  /** One per editor tab, so two tabs of one person are two entries. */
  clientId: string;
  actor: string;
  color: string;
  selection: Selection | null;
  /** Their pointer on the ground, in plan metres. */
  cursor?: Vec2 | null;
  /** The opening they are dragging right now, where it is at this moment. */
  dragging?: DragPreview | null;
  /** The account behind the tab; the header shows one avatar per person, not per tab. */
  userId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Here, or away with the tab hidden; which page of the project and which storey. */
  state?: "here" | "away";
  page?: string | null;
  storeyId?: string | null;
}

export interface EditorActions {
  setFootprintVertex: (index: number, position: Vec2) => void;
  /** Inserts a vertex at the midpoint of edge `edgeIndex`. */
  insertFootprintVertex: (edgeIndex: number) => void;
  /** Removes a vertex if the footprint stays a valid polygon. */
  removeFootprintVertex: (index: number) => void;
  moveStorey: (storeyId: Id, direction: -1 | 1) => void;
  /** Removes whatever is selected, if it is removable. */
  deleteSelection: () => void;
  addStorey: () => void;
  removeStorey: (storeyId: Id) => void;
  setStoreyHeight: (storeyId: Id, height: number) => void;
  renameStorey: (storeyId: Id, name: string) => void;
  setWallThickness: (thickness: number) => void;
  renameBuilding: (name: string) => void;
  setOrigin: (origin: GeoOrigin | undefined) => void;
  setBridgeDetail: (detail: "good" | "poor") => void;
  /**
   * How the energy balance is counted: thermal bridge method and ΔU_WB, the primary energy
   * factor set, the living area for the consumption check. Undefined clears a value.
   */
  setEnergyMethod: (
    patch: Partial<Pick<Building, "bridgeMethod" | "bridgeSurcharge" | "factorSet" | "livingArea">>,
  ) => void;
  /**
   * Gives the envelope the default U-values of its age (geometry/ageDefaults.ts): wall, roof,
   * floor, and every exterior window and door. One undo step.
   */
  applyAgeDefaults: (choice: AgeChoice) => void;
  /**
   * Gives every window in `scope` the window type `typeId` (geometry/windows.ts), adding the
   * type to the building's constructions when it is new. The whole building also makes it
   * the default for new windows. One undo step.
   */
  replaceWindows: (scope: WindowScope, typeId: string) => void;
  /** Changes the heating system; missing fields keep their value (or the default system's). */
  setHeating: (patch: Partial<HeatingSystem>) => void;
  /** Changes prices, CO2 price, occupancy, dwellings or the iSFP flag. */
  setEconomics: (patch: Partial<Economics>) => void;
  setRoof: (patch: Partial<Roof>) => void;
  /** Mark a footprint edge as a party wall against a heated neighbour, or clear it. */
  setEdgeShared: (edgeIndex: number, shared: boolean) => void;
  addRadiator: (storeyId: Id, radiator: Omit<Radiator, "id">) => Id;
  updateRadiator: (storeyId: Id, id: Id, patch: Partial<Omit<Radiator, "id">>) => void;
  removeRadiator: (storeyId: Id, id: Id) => void;
  addHeatPump: (pump: Omit<HeatPump, "id">) => Id;
  updateHeatPump: (id: Id, patch: Partial<Omit<HeatPump, "id">>) => void;
  removeHeatPump: (id: Id) => void;
  addPipe: (storeyId: Id, points: Vec2[]) => Id;
  removePipe: (storeyId: Id, id: Id) => void;
  /** Keeps a distance measured on the storey; returns its id. */
  addMeasurement: (storeyId: Id, a: Vec2, b: Vec2) => Id;
  removeMeasurement: (storeyId: Id, id: Id) => void;
  /** Replaces the footprint, for a GeoJSON import. Rooms are recomputed. */
  setFootprint: (footprint: Vec2[], origin?: GeoOrigin) => void;
  /** Resizes a rectangular footprint about its centre; openings are clamped into their walls. */
  resizeFootprint: (width: number, depth: number) => void;
  /** Slides the whole building on the plan; the geo origin stays. */
  translateBuilding: (delta: Vec2) => void;
  /** Turns the whole building about its footprint centre. */
  rotateBuilding: (degrees: number) => void;
  /** Makes the building centre the new plan origin and moves the geo origin with it. */
  recentreOrigin: () => void;
  addOpening: (storeyId: Id, opening: NewOpening) => Id;
  updateOpening: (storeyId: Id, openingId: Id, patch: Partial<Omit<Opening, "id">>) => void;
  removeOpening: (storeyId: Id, openingId: Id) => void;
  addInteriorWall: (storeyId: Id, segment: Segment) => void;
  /**
   * Replaces a storey's interior walls and openings with an edit of them (a wall end moved,
   * geometry/wallDrawing.ts) and finds its rooms again.
   */
  applyWallEdit: (storeyId: Id, edit: { walls: InteriorWall[]; openings: Opening[] }) => void;
  /** Gives interior wall `index` a type (a construction of kind "interiorWall"). */
  setInteriorWallType: (storeyId: Id, index: number, constructionId: Id) => void;
  /**
   * A read floor plan on one storey: its interior walls and interior doors are replaced by the
   * plan's, rooms follow. One undo step. See geometry/floorPlanImport.ts.
   */
  applyFloorPlan: (storeyId: Id, edits: FloorPlanEdits) => void;
  /** Takes a storey's interior walls and their doors out: back to one room in the outline. */
  clearInteriors: (storeyId: Id) => void;
  removeInteriorWall: (storeyId: Id, index: number) => void;
  renameRoom: (storeyId: Id, roomId: Id, name: string) => void;
  assignRoomToZone: (storeyId: Id, roomId: Id, zoneId: Id | undefined) => void;
  addZone: (name: string, color: string, heated?: boolean) => Id;
  setZoneHeated: (zoneId: Id, heated: boolean) => void;
  updateConstruction: (constructionId: Id, patch: Partial<Omit<Construction, "id">>) => void;
  addLayer: (constructionId: Id, layer?: Omit<Layer, "id">) => void;
  updateLayer: (constructionId: Id, layerId: Id, patch: Partial<Omit<Layer, "id">>) => void;
  removeLayer: (constructionId: Id, layerId: Id) => void;
  moveLayer: (constructionId: Id, layerId: Id, direction: -1 | 1) => void;
  assignConstruction: (target: ConstructionTarget, constructionId: Id) => void;
  updateZone: (zoneId: Id, patch: Partial<Omit<Zone, "id">>) => void;
  removeZone: (zoneId: Id) => void;
  loadBuilding: (building: Building) => void;
  setActiveStorey: (storeyId: Id) => void;
  select: (selection: Selection) => void;
  clearSelection: () => void;
  setHovered: (hovered: Selection | null) => void;
  setHighlightedWall: (edge: number | null) => void;
  setActiveZone: (zoneId: Id | null) => void;
  setRenovatedView: (on: boolean) => void;
  setViewScenario: (id: string | null) => void;
  addScenario: (name: string, from?: Partial<Scenario>) => Id;
  updateScenario: (id: Id, patch: Partial<Omit<Scenario, "id">>) => void;
  removeScenario: (id: Id) => void;
  setPresence: (presence: Presence[]) => void;
  setHistoryPreview: (preview: HistoryPreview | null) => void;
  /** Writes a note on `target`, signed with `author`. Returns its id. */
  addNote: (target: NoteTarget, text: string, author: string) => Id;
  /** Marks a note as dealt with, or open again. */
  setNoteDone: (id: Id, done: boolean) => void;
  removeNote: (id: Id) => void;
  setPhotoWall: (edge: number | null) => void;
  /** Keeps (or with null forgets) the straightened photo of a facade. Frees the replaced one. */
  setFacadePhoto: (edge: number, photo: FacadePhoto | null) => void;
  setFloorPlanImage: (storeyId: Id, image: FacadePhoto | null) => void;
  /** Drops every facade photo and floor plan image: a new project starts without any. */
  clearProjectMedia: () => void;
  setShowFacadePhotos: (on: boolean) => void;
  setFacadePhotoTransparency: (percent: number) => void;
  /**
   * Takes the openings a photo measured on footprint edge `wallIndex`: `next` is the
   * building with that wall's openings replaced (geometry/photoWall.ts). One undo step; the
   * wall stays selected.
   */
  applyWallOpenings: (next: Building, wallIndex: number) => void;
  /** Updates one other tab's presence, when it is known. */
  patchPresence: (clientId: string, patch: Partial<Omit<Presence, "clientId">>) => void;
  setProjectId: (projectId: string | null) => void;
  setProjectRole: (role: Role | null) => void;
  setFollowing: (clientId: string | null) => void;
  setLastSeenAt: (at: string | null) => void;
  /** The facade colour read from a photo, or null for the neutral wall colour. */
  setFacadeColor: (color: string | null) => void;
  /** Changes the project facts the Projects page shows: client, stage, report time. */
  setProjectInfo: (patch: Partial<ProjectInfo>) => void;
  duplicateStorey: (storeyId: Id) => void;
  setPlanView: (on: boolean) => void;
  endPlanReveal: () => void;
  setUnderlay: (underlay: Underlay | null) => void;
  setMeasurement: (measurement: { a: Vec2; b: Vec2 } | null) => void;
  setTheme: (theme: Theme) => void;
  setShowMap: (on: boolean) => void;
  setShowBridges: (on: boolean) => void;
  setOtherStoreys: (patch: Partial<OtherStoreys>) => void;
  setMapOpacity: (opacity: number) => void;
  setCameraView: (view: CameraView) => void;
  toggleStoreyHidden: (storeyId: Id) => void;
  /** Replaces the building with server state. Not recorded in history and clears the redo stack. */
  /**
   * Shows a building that came from the server, outside the undo history. `rebase` says
   * what happens to the history: a function is applied to every undo and redo snapshot
   * (the other person's edits, so undo only takes back your own); null empties both
   * stacks (a project opened fresh); left out, only redo is emptied.
   */
  applyRemoteBuilding: (
    building: Building,
    rebase?: ((snapshot: Building) => Building) | null,
  ) => void;
  setShowGrid: (show: boolean) => void;
  setTool: (tool: Tool) => void;
  setLanguage: (language: Language) => void;
}

/** The construction defaults to the building's window or door construction. */
export type NewOpening = Omit<Opening, "id" | "constructionId"> & { constructionId?: Id };

export type ConstructionTarget =
  | { kind: "wall" | "floor" | "roof" | "window" | "door" }
  | { kind: "opening"; storeyId: Id; id: Id };

export type EditorStore = EditorState & EditorActions & HistorySlice;

export function createStorey(index: number, language: Language): Storey {
  return {
    id: createId("storey"),
    name: defaultStoreyName(index, language),
    height: DEFAULT_STOREY_HEIGHT,
    openings: [],
    interiorWalls: [],
    rooms: [],
  };
}

/** A 10 m by 8 m rectangle, one storey, no openings. Counter-clockwise on the XZ plane. */
export function createDefaultBuilding(language: Language = "en"): Building {
  const building: Building = {
    id: createId("building"),
    name: "Bauwerk",
    footprint: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ],
    wallThickness: DEFAULT_WALL_THICKNESS,
    storeys: [createStorey(0, language)],
    zones: [],
    constructions: defaultConstructions(language),
    ...DEFAULT_ASSIGNMENT,
  };
  refreshAllRooms(building, language);
  return building;
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function findStorey(building: Building, storeyId: Id): Storey | undefined {
  return building.storeys.find((s) => s.id === storeyId);
}

/** Rooms are derived. Recompute them whenever the footprint or the interior walls change. */
/**
 * Keeps interior walls as pieces from joint to joint (geometry/wallGraph.ts): split where a
 * wall joins or crosses another, joined where two meet straight with nothing else there.
 */
function tidyWalls(storey: Storey): void {
  const tidy = normalizeWalls({ walls: storey.interiorWalls, openings: storey.openings });
  storey.interiorWalls = tidy.walls;
  storey.openings = tidy.openings;
}

function refreshRooms(storey: Storey, footprint: readonly Vec2[], language: Language): void {
  tidyWalls(storey);
  storey.rooms = computeRooms(footprint, storey.interiorWalls, storey.rooms, {
    createId: () => createId("room"),
    defaultName: (i) => defaultRoomName(i, language),
  });
}

function refreshAllRooms(building: Building, language: Language): void {
  for (const storey of building.storeys) refreshRooms(storey, building.footprint, language);
}

/**
 * Carries what points at a footprint edge along with an edit that renumbers the edges: wall
 * notes, facade photos, the wall open in the photo editor, the lit wall and a selected wall.
 * Openings and radiators are placed by the edit itself, since their offsets matter too.
 */
function remapEdgeRefs(state: EditorState, change: EdgeChange): void {
  const to = (i: number) => remapEdgeIndex(i, change).index;
  for (const note of state.building.notes ?? []) {
    if (note.target.kind === "wall") note.target.wallIndex = to(note.target.wallIndex);
  }
  const photos: Record<number, FacadePhoto> = {};
  for (const [edge, photo] of Object.entries(state.facadePhotos)) {
    const i = to(Number(edge));
    // Two walls merged into one: the first photo stays, the other goes.
    if (photos[i]) URL.revokeObjectURL(photo.url);
    else photos[i] = photo;
  }
  state.facadePhotos = photos;
  if (state.photoWall !== null) state.photoWall = to(state.photoWall);
  if (state.highlightedWall !== null) state.highlightedWall = to(state.highlightedWall);
  if (state.selection?.kind === "wall") state.selection.wallIndex = to(state.selection.wallIndex);
}

export function createEditorStore(initial?: Partial<EditorState>) {
  return create<EditorStore>()(
    history(
      immer((set, get) => {
        const language = initial?.language ?? "en";
        const building = localizeBuilding(
          initial?.building ?? createDefaultBuilding(language),
          language,
        );
        return {
          building,
          activeStoreyId: initial?.activeStoreyId ?? building.storeys[0]?.id ?? null,
          selection: initial?.selection ?? null,
          hovered: null,
          highlightedWall: null,
          tool: initial?.tool ?? "select",
          language,
          showGrid: initial?.showGrid ?? true,
          activeZoneId: initial?.activeZoneId ?? null,
          renovatedView: false,
          viewScenarioId: null,
          presence: [],
          historyPreview: null,
          photoWall: null,
          facadePhotos: {},
          floorPlanImages: {},
          showFacadePhotos: true,
          facadePhotoTransparency: 0,
          projectId: null,
          projectRole: null,
          following: null,
          lastSeenAt: null,
          planView: false,
          planReveal: null,
          underlay: null,
          measurement: null,
          theme: initial?.theme ?? "light",
          // The plain grid is the default ground; the map is an option in the settings.
          showMap: false,
          showBridges: false,
          otherStoreys: { above: "outline", below: "ghost", roof: "outline", ghostOpacity: 0.15 },
          cameraView: { view: "3d", nonce: 0 },
          hiddenStoreys: [],
          mapOpacity: 0.85,

          setFootprintVertex: (index, position) => {
            set((state) => {
              if (index < 0 || index >= state.building.footprint.length) return;
              if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
              const next = state.building.footprint.map((point, pointIndex) =>
                pointIndex === index ? { x: position.x, y: position.y } : point,
              );
              if (!isSimplePolygon(next) || !isCounterClockwise(next)) return;
              state.building.footprint = next;
              refreshAllRooms(state.building, state.language);
            });
          },

          insertFootprintVertex: (edgeIndex) => {
            set((state) => {
              const fp = state.building.footprint;
              const a = fp[edgeIndex];
              const b = fp[(edgeIndex + 1) % fp.length];
              if (!a || !b) return;
              // The exact midpoint: snapped to the grid it would leave a diagonal edge and put
              // a kink in the wall. Dragging the vertex afterwards snaps it.
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const next = [...fp.slice(0, edgeIndex + 1), mid, ...fp.slice(edgeIndex + 1)];
              if (!isSimplePolygon(next)) return;
              state.building.footprint = next;
              // Edges after the split move up by one; openings and radiators on the split edge
              // go to the half they sit on, and one that spans the new corner is removed.
              const splitAt = Math.hypot(mid.x - a.x, mid.y - a.y);
              for (const storey of state.building.storeys) {
                storey.openings = storey.openings.flatMap((o) => {
                  if (o.interior) return [o];
                  const placed = placeAfterSplit(
                    o.wallIndex,
                    o.offset,
                    o.width,
                    edgeIndex,
                    splitAt,
                  );
                  return placed ? [{ ...o, ...placed }] : [];
                });
                if (storey.radiators) {
                  storey.radiators = storey.radiators.flatMap((r) => {
                    const placed = placeAfterSplit(
                      r.wallIndex,
                      r.offset,
                      r.width,
                      edgeIndex,
                      splitAt,
                    );
                    return placed ? [{ ...r, ...placed }] : [];
                  });
                }
              }
              if (state.building.sharedEdges) {
                state.building.sharedEdges = sharedAfterSplit(
                  state.building.sharedEdges,
                  edgeIndex,
                );
              }
              remapEdgeRefs(state, { kind: "split", edge: edgeIndex });
              state.selection = { kind: "vertex", index: edgeIndex + 1 };
              refreshAllRooms(state.building, state.language);
            });
          },

          removeFootprintVertex: (index) => {
            set((state) => {
              const fp = state.building.footprint;
              if (fp.length <= 3 || index < 0 || index >= fp.length) return;
              const next = fp.filter((_, i) => i !== index);
              if (!isSimplePolygon(next) || !isCounterClockwise(next)) return;
              state.building.footprint = next;
              // Exterior openings and radiators index footprint edges, so edges after the removed
              // vertex shift down and the two edges that merged lose theirs. Interior openings
              // index interior walls and stay as they are.
              const change: EdgeChange = { kind: "remove", vertex: index, count: fp.length };
              const place = <T extends { wallIndex: number }>(item: T): T[] => {
                const to = remapEdgeIndex(item.wallIndex, change);
                return to.same ? [{ ...item, wallIndex: to.index }] : [];
              };
              for (const storey of state.building.storeys) {
                storey.openings = storey.openings.flatMap((o) => (o.interior ? [o] : place(o)));
                if (storey.radiators) storey.radiators = storey.radiators.flatMap(place);
              }
              remapEdgeRefs(state, change);
              if (state.building.sharedEdges) {
                state.building.sharedEdges = sharedAfterRemove(
                  state.building.sharedEdges,
                  index,
                  fp.length,
                );
              }
              if (state.selection?.kind === "vertex") state.selection = null;
              refreshAllRooms(state.building, state.language);
            });
          },

          moveStorey: (storeyId, direction) => {
            set((state) => {
              const list = state.building.storeys;
              const from = list.findIndex((s) => s.id === storeyId);
              const to = from + direction;
              if (from === -1 || to < 0 || to >= list.length) return;
              const [item] = list.splice(from, 1);
              if (item) list.splice(to, 0, item);
            });
          },

          deleteSelection: () => {
            const { selection } = get();
            if (!selection) return;
            const actions = get();
            switch (selection.kind) {
              case "opening":
                actions.removeOpening(selection.storeyId, selection.id);
                break;
              case "interiorWall":
                actions.removeInteriorWall(selection.storeyId, selection.index);
                break;
              case "storey":
                actions.removeStorey(selection.id);
                break;
              case "zone":
                actions.removeZone(selection.id);
                break;
              case "vertex":
                actions.removeFootprintVertex(selection.index);
                break;
              case "radiator":
                actions.removeRadiator(selection.storeyId, selection.id);
                break;
              case "heatPump":
                actions.removeHeatPump(selection.id);
                break;
              case "pipe":
                actions.removePipe(selection.storeyId, selection.id);
                break;
              case "measurement":
                actions.removeMeasurement(selection.storeyId, selection.id);
                break;
              case "wall":
              case "room":
              case "roof":
                break;
            }
          },

          addStorey: () => {
            set((state) => {
              const storey = createStorey(state.building.storeys.length, state.language);
              refreshRooms(storey, state.building.footprint, state.language);
              state.building.storeys.push(storey);
              state.activeStoreyId = storey.id;
            });
          },

          removeStorey: (storeyId) => {
            set((state) => {
              const index = state.building.storeys.findIndex((s) => s.id === storeyId);
              if (index === -1) return;
              state.building.storeys.splice(index, 1);
              if (state.activeStoreyId === storeyId) {
                const neighbour =
                  state.building.storeys[index] ?? state.building.storeys[index - 1];
                state.activeStoreyId = neighbour?.id ?? null;
              }
              if (state.selection && "storeyId" in state.selection) {
                if (state.selection.storeyId === storeyId) state.selection = null;
              } else if (state.selection?.kind === "storey" && state.selection.id === storeyId) {
                state.selection = null;
              }
            });
          },

          setStoreyHeight: (storeyId, height) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (storey) storey.height = height;
            });
          },

          renameStorey: (storeyId, name) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (storey) storey.name = name;
            });
          },

          addRadiator: (storeyId, radiator) => {
            const id = createId("radiator");
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.radiators ??= [];
              storey.radiators.push({ ...radiator, id });
            });
            return id;
          },

          updateRadiator: (storeyId, id, patch) => {
            set((state) => {
              const r = findStorey(state.building, storeyId)?.radiators?.find((x) => x.id === id);
              if (r) Object.assign(r, patch);
            });
          },

          removeRadiator: (storeyId, id) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey?.radiators) return;
              storey.radiators = storey.radiators.filter((x) => x.id !== id);
              if (state.selection?.kind === "radiator" && state.selection.id === id)
                state.selection = null;
            });
          },

          addHeatPump: (pump) => {
            const id = createId("pump");
            set((state) => {
              state.building.heatPumps ??= [];
              state.building.heatPumps.push({ ...pump, id, position: { ...pump.position } });
            });
            return id;
          },

          updateHeatPump: (id, patch) => {
            set((state) => {
              const p = state.building.heatPumps?.find((x) => x.id === id);
              if (p) Object.assign(p, patch);
            });
          },

          removeHeatPump: (id) => {
            set((state) => {
              if (!state.building.heatPumps) return;
              state.building.heatPumps = state.building.heatPumps.filter((x) => x.id !== id);
              if (state.selection?.kind === "heatPump" && state.selection.id === id)
                state.selection = null;
            });
          },

          addPipe: (storeyId, points) => {
            const id = createId("pipe");
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey || points.length < 2) return;
              storey.pipes ??= [];
              storey.pipes.push({ id, points: points.map((p) => ({ ...p })) });
            });
            return id;
          },

          addMeasurement: (storeyId, a, b) => {
            const id = createId("measure");
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.measurements ??= [];
              storey.measurements.push({ id, a: { ...a }, b: { ...b } });
              // The last distance measured is also what the underlay's scale reads.
              state.measurement = { a: { ...a }, b: { ...b } };
            });
            return id;
          },

          removeMeasurement: (storeyId, id) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey?.measurements) return;
              storey.measurements = storey.measurements.filter((m) => m.id !== id);
              if (storey.measurements.length === 0) delete storey.measurements;
              if (state.selection?.kind === "measurement" && state.selection.id === id)
                state.selection = null;
            });
          },

          removePipe: (storeyId, id) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey?.pipes) return;
              storey.pipes = storey.pipes.filter((x) => x.id !== id);
              if (state.selection?.kind === "pipe" && state.selection.id === id)
                state.selection = null;
            });
          },

          setEdgeShared: (edgeIndex, shared) => {
            set((state) => {
              const count = state.building.footprint.length;
              if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= count) return;
              const current = new Set(state.building.sharedEdges ?? []);
              if (shared) current.add(edgeIndex);
              else current.delete(edgeIndex);
              state.building.sharedEdges = [...current].sort((a, b) => a - b);
            });
          },

          setRoof: (patch) => {
            set((state) => {
              state.building.roof = { ...roofOf(state.building), ...patch };
            });
          },

          setBridgeDetail: (detail) => {
            set((state) => {
              state.building.bridgeDetail = detail;
            });
          },

          setEnergyMethod: (patch) => {
            set((state) => {
              const b = state.building;
              if ("bridgeMethod" in patch) {
                if (patch.bridgeMethod) b.bridgeMethod = patch.bridgeMethod;
                else delete b.bridgeMethod;
              }
              if ("bridgeSurcharge" in patch) {
                if (patch.bridgeSurcharge !== undefined) b.bridgeSurcharge = patch.bridgeSurcharge;
                else delete b.bridgeSurcharge;
              }
              if ("factorSet" in patch) {
                if (patch.factorSet) b.factorSet = patch.factorSet;
                else delete b.factorSet;
              }
              if ("livingArea" in patch) {
                if (patch.livingArea !== undefined) b.livingArea = patch.livingArea;
                else delete b.livingArea;
              }
            });
          },

          applyAgeDefaults: (choice) => {
            set((state) => {
              const b = state.building;
              const defaults = ageConstructions(choice, state.language);
              b.constructions = [
                ...b.constructions.filter((c) => !defaults.some((d) => d.id === c.id)),
                ...defaults,
              ];
              b.wallConstructionId = AGE_IDS.wall;
              b.roofConstructionId = AGE_IDS.roof;
              b.floorConstructionId = AGE_IDS.floor;
              b.windowConstructionId = AGE_IDS.window;
              b.doorConstructionId = AGE_IDS.door;
              for (const storey of b.storeys)
                for (const o of storey.openings)
                  if (!o.interior)
                    o.constructionId = o.kind === "window" ? AGE_IDS.window : AGE_IDS.door;
              b.yearBuilt = choice.year;
            });
          },

          replaceWindows: (scope, typeId) => {
            const type = windowType(typeId);
            if (!type) return;
            set((state) => {
              const b = state.building;
              if (!b.constructions.some((c) => c.id === type.id)) {
                b.constructions.push(windowConstruction(type, state.language));
              }
              for (const storey of b.storeys) {
                if (scope.kind === "storey" && storey.id !== scope.storeyId) continue;
                if (scope.kind === "opening" && storey.id !== scope.storeyId) continue;
                for (const o of storey.openings) {
                  if (o.kind !== "window") continue;
                  if (scope.kind === "opening" && o.id !== scope.id) continue;
                  // Windows in interior walls are not envelope; only a direct pick changes one.
                  if (o.interior && scope.kind !== "opening") continue;
                  if (scope.kind === "wall" && (o.interior || o.wallIndex !== scope.wallIndex))
                    continue;
                  o.constructionId = type.id;
                }
              }
              if (scope.kind === "building") b.windowConstructionId = type.id;
            });
          },

          setHeating: (patch) => {
            set((state) => {
              state.building.heating = { ...heatingOf(state.building), ...patch };
            });
          },

          setEconomics: (patch) => {
            set((state) => {
              const current = state.building.economics ?? {};
              state.building.economics = {
                ...current,
                ...patch,
                ...(patch.prices ? { prices: { ...current.prices, ...patch.prices } } : {}),
              };
            });
          },

          resizeFootprint: (width, depth) => {
            set((state) => {
              state.building = resizeRectangle(state.building, width, depth);
              refreshAllRooms(state.building, state.language);
            });
          },

          translateBuilding: (delta) => {
            set((state) => {
              state.building = translateBuilding(state.building, delta);
            });
          },

          rotateBuilding: (degrees) => {
            set((state) => {
              state.building = rotateBuilding(state.building, degrees);
            });
          },

          recentreOrigin: () => {
            set((state) => {
              const b = state.building;
              const centre = buildingCentre(b);
              if (b.origin) {
                const geo = planToLatLon(centre, b.origin);
                state.building.origin = { ...b.origin, lat: geo.lat, lon: geo.lon };
              }
              state.building = translateBuilding(state.building, {
                x: -centre.x,
                y: -centre.y,
              });
            });
          },

          setOrigin: (origin) => {
            set((state) => {
              if (origin === undefined) delete state.building.origin;
              else state.building.origin = { ...origin };
            });
          },

          setFootprint: (footprint, origin) => {
            set((state) => {
              if (
                !footprint.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ||
                !isSimplePolygon(footprint)
              )
                return;
              state.building.footprint = ensureCounterClockwise(footprint);
              if (origin) state.building.origin = { ...origin };
              // A new outline has new walls: what sat on the old ones goes, and which of them
              // touch a neighbour is unknown. Interior walls stay, with their openings.
              for (const storey of state.building.storeys) {
                storey.openings = storey.openings.filter((o) => o.interior);
                if (storey.radiators) storey.radiators = [];
              }
              delete state.building.sharedEdges;
              for (const note of state.building.notes ?? []) {
                if (note.target.kind === "wall") note.target = { kind: "building" };
              }
              for (const photo of Object.values(state.facadePhotos)) URL.revokeObjectURL(photo.url);
              state.facadePhotos = {};
              state.photoWall = null;
              state.highlightedWall = null;
              state.selection = null;
              refreshAllRooms(state.building, state.language);
            });
          },

          renameBuilding: (name) => {
            set((state) => {
              state.building.name = name;
            });
          },

          setWallThickness: (thickness) => {
            set((state) => {
              state.building.wallThickness = thickness;
            });
          },

          addOpening: (storeyId, opening) => {
            const id = createId("opening");
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              const constructionId =
                opening.constructionId ??
                (opening.kind === "door"
                  ? state.building.doorConstructionId
                  : state.building.windowConstructionId);
              storey.openings.push({ ...opening, constructionId, id });
            });
            return id;
          },

          updateOpening: (storeyId, openingId, patch) => {
            set((state) => {
              const opening = findStorey(state.building, storeyId)?.openings.find(
                (o) => o.id === openingId,
              );
              if (opening) Object.assign(opening, patch);
            });
          },

          removeOpening: (storeyId, openingId) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.openings = storey.openings.filter((o) => o.id !== openingId);
              if (state.selection?.kind === "opening" && state.selection.id === openingId) {
                state.selection = null;
              }
            });
          },

          addInteriorWall: (storeyId, segment) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.interiorWalls.push({ a: { ...segment.a }, b: { ...segment.b } });
              refreshRooms(storey, state.building.footprint, state.language);
            });
          },

          applyWallEdit: (storeyId, edit) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.interiorWalls = edit.walls.map((w) => ({
                ...w,
                a: { ...w.a },
                b: { ...w.b },
              }));
              storey.openings = edit.openings.map((o) => ({ ...o }));
              refreshRooms(storey, state.building.footprint, state.language);
            });
          },

          applyFloorPlan: (storeyId, edits) => {
            // The others see a toast; the walls themselves travel as ops.
            shareActivity({ kind: "floorPlan", storeyId });
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.interiorWalls = edits.interiorWalls.map((w) => ({
                ...w,
                a: { ...w.a },
                b: { ...w.b },
              }));
              storey.openings = [
                ...storey.openings.filter((o) => !o.interior),
                ...edits.doors.map((door) => ({
                  ...asOpening(door, createId("opening")),
                  constructionId: state.building.doorConstructionId,
                })),
              ];
              refreshRooms(storey, state.building.footprint, state.language);
              for (const room of storey.rooms) {
                const name = nameForRoom(room.polygon, edits.roomNames ?? []);
                if (name) room.name = name;
              }
              if (
                state.selection &&
                "storeyId" in state.selection &&
                state.selection.storeyId === storeyId
              )
                state.selection = null;
              state.planReveal = { storeyId, startedAt: performance.now() };
            });
          },

          setInteriorWallType: (storeyId, index, constructionId) => {
            set((state) => {
              const wall = findStorey(state.building, storeyId)?.interiorWalls[index];
              const known = state.building.constructions.some(
                (c) => c.id === constructionId && c.category === "interiorWall",
              );
              if (!wall || !known) return;
              wall.constructionId = constructionId;
            });
          },

          clearInteriors: (storeyId) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey) return;
              storey.interiorWalls = [];
              storey.openings = storey.openings.filter((o) => !o.interior);
              refreshRooms(storey, state.building.footprint, state.language);
              if (
                state.selection &&
                "storeyId" in state.selection &&
                state.selection.storeyId === storeyId
              )
                state.selection = null;
            });
          },
          removeInteriorWall: (storeyId, index) => {
            set((state) => {
              const storey = findStorey(state.building, storeyId);
              if (!storey || index < 0 || index >= storey.interiorWalls.length) return;
              storey.interiorWalls.splice(index, 1);
              storey.openings = storey.openings
                .filter((o) => !(o.interior && o.wallIndex === index))
                .map((o) =>
                  o.interior && o.wallIndex > index ? { ...o, wallIndex: o.wallIndex - 1 } : o,
                );
              refreshRooms(storey, state.building.footprint, state.language);
              if (
                state.selection?.kind === "interiorWall" &&
                state.selection.storeyId === storeyId
              ) {
                if (state.selection.index === index) state.selection = null;
                else if (state.selection.index > index) state.selection.index -= 1;
              }
            });
          },

          renameRoom: (storeyId, roomId, name) => {
            set((state) => {
              const room = findStorey(state.building, storeyId)?.rooms.find((r) => r.id === roomId);
              if (room) room.name = name;
            });
          },

          assignRoomToZone: (storeyId, roomId, zoneId) => {
            set((state) => {
              const room = findStorey(state.building, storeyId)?.rooms.find((r) => r.id === roomId);
              if (!room) return;
              if (zoneId === undefined) delete room.zoneId;
              else room.zoneId = zoneId;
            });
          },

          addZone: (name, color, heated = true) => {
            const id = createId("zone");
            set((state) => {
              state.building.zones.push({
                id,
                name,
                color,
                heated,
                temperature: heated ? HEATED_TEMPERATURE : UNHEATED_TEMPERATURE,
              });
            });
            return id;
          },

          setZoneHeated: (zoneId, heated) => {
            set((state) => {
              const zone = state.building.zones.find((z) => z.id === zoneId);
              if (!zone || zone.heated === heated) return;
              zone.heated = heated;
              zone.temperature = heated ? HEATED_TEMPERATURE : UNHEATED_TEMPERATURE;
            });
          },

          updateConstruction: (constructionId, patch) => {
            set((state) => {
              const c = state.building.constructions.find((x) => x.id === constructionId);
              if (!c) return;
              Object.assign(c, patch);
              if (c.layers && c.layers.length > 0)
                c.uValue = uValueFromLayers(c.layers, c.category);
            });
          },

          addLayer: (constructionId, layer) => {
            set((state) => {
              const c = state.building.constructions.find((x) => x.id === constructionId);
              if (!c) return;
              c.layers ??= [];
              c.layers.push({
                id: createId("layer"),
                name: "",
                thickness: 0.1,
                conductivity: 0.5,
                ...layer,
              });
              c.uValue = uValueFromLayers(c.layers, c.category);
            });
          },

          updateLayer: (constructionId, layerId, patch) => {
            set((state) => {
              const c = state.building.constructions.find((x) => x.id === constructionId);
              const l = c?.layers?.find((x) => x.id === layerId);
              if (!c?.layers || !l) return;
              Object.assign(l, patch);
              c.uValue = uValueFromLayers(c.layers, c.category);
            });
          },

          removeLayer: (constructionId, layerId) => {
            set((state) => {
              const c = state.building.constructions.find((x) => x.id === constructionId);
              if (!c?.layers) return;
              c.layers = c.layers.filter((x) => x.id !== layerId);
              if (c.layers.length === 0) delete c.layers;
              else c.uValue = uValueFromLayers(c.layers, c.category);
            });
          },

          moveLayer: (constructionId, layerId, direction) => {
            set((state) => {
              const c = state.building.constructions.find((x) => x.id === constructionId);
              if (!c?.layers) return;
              const from = c.layers.findIndex((x) => x.id === layerId);
              const to = from + direction;
              if (from === -1 || to < 0 || to >= c.layers.length) return;
              const [item] = c.layers.splice(from, 1);
              if (item) c.layers.splice(to, 0, item);
            });
          },

          assignConstruction: (target, constructionId) => {
            set((state) => {
              const b = state.building;
              if (!b.constructions.some((c) => c.id === constructionId)) return;
              switch (target.kind) {
                case "wall":
                  b.wallConstructionId = constructionId;
                  break;
                case "floor":
                  b.floorConstructionId = constructionId;
                  break;
                case "roof":
                  b.roofConstructionId = constructionId;
                  break;
                case "window":
                  b.windowConstructionId = constructionId;
                  break;
                case "door":
                  b.doorConstructionId = constructionId;
                  break;
                case "opening": {
                  const o = findStorey(b, target.storeyId)?.openings.find(
                    (x) => x.id === target.id,
                  );
                  if (o) o.constructionId = constructionId;
                  break;
                }
              }
            });
          },

          updateZone: (zoneId, patch) => {
            set((state) => {
              const zone = state.building.zones.find((z) => z.id === zoneId);
              if (zone) Object.assign(zone, patch);
            });
          },

          removeZone: (zoneId) => {
            set((state) => {
              state.building.zones = state.building.zones.filter((z) => z.id !== zoneId);
              for (const storey of state.building.storeys) {
                for (const room of storey.rooms) {
                  if (room.zoneId === zoneId) delete room.zoneId;
                }
              }
              if (state.selection?.kind === "zone" && state.selection.id === zoneId) {
                state.selection = null;
              }
              if (state.activeZoneId === zoneId) state.activeZoneId = null;
            });
          },

          loadBuilding: (next) => {
            // Photos belong to the walls of the building they were taken of, keyed by wall
            // number: another building must not show them on its own walls. The same building
            // loaded again (with its project facts, or merged) keeps them.
            const other = next.id !== get().building.id;
            if (other)
              for (const photo of [
                ...Object.values(get().facadePhotos),
                ...Object.values(get().floorPlanImages),
              ])
                URL.revokeObjectURL(photo.url);
            set((state) => {
              if (other) {
                state.facadePhotos = {};
                state.floorPlanImages = {};
                state.photoWall = null;
              }
              state.building = localizeBuilding(next, state.language);
              // Interior wall types came later: a building from before gets the presets.
              state.building.constructions = withInteriorWallTypes(
                state.building.constructions,
                state.language,
              );
              // Walls from a file or an older project, as pieces from joint to joint, and rooms
              // found again from them: a stored room outline or area is never trusted as is.
              refreshAllRooms(state.building, state.language);
              state.activeStoreyId = state.building.storeys[0]?.id ?? null;
              state.activeZoneId = null;
              state.selection = null;
              state.hovered = null;
              state.renovatedView = false;
              state.viewScenarioId = null;
              state.underlay = null;
              state.measurement = null;
            });
          },

          setActiveStorey: (storeyId) => {
            set((state) => {
              if (findStorey(state.building, storeyId)) state.activeStoreyId = storeyId;
            });
          },

          select: (selection) => {
            set((state) => {
              state.selection = selection;
            });
          },

          clearSelection: () => {
            set((state) => {
              state.selection = null;
            });
          },

          setHighlightedWall: (edge) => {
            set((state) => {
              state.highlightedWall = edge;
            });
          },

          setHovered: (hovered) => {
            set((state) => {
              if (sameSelection(state.hovered, hovered)) return;
              state.hovered = hovered;
            });
          },

          duplicateStorey: (storeyId) => {
            set((state) => {
              const index = state.building.storeys.findIndex((s) => s.id === storeyId);
              const source = state.building.storeys[index];
              if (!source) return;
              const copy: Storey = {
                id: createId("storey"),
                name: defaultStoreyName(index + 1, state.language),
                height: source.height,
                openings: source.openings.map((o) => ({ ...o, id: createId("opening") })),
                interiorWalls: source.interiorWalls.map((w) => ({
                  ...w,
                  a: { ...w.a },
                  b: { ...w.b },
                })),
                rooms: source.rooms.map((r) => ({
                  ...r,
                  id: createId("room"),
                  polygon: r.polygon.map((p) => ({ ...p })),
                })),
              };
              state.building.storeys.splice(index + 1, 0, copy);
              state.activeStoreyId = copy.id;
            });
          },

          setPlanView: (on) => {
            set((state) => {
              state.planView = on;
            });
          },

          endPlanReveal: () => {
            set((state) => {
              state.planReveal = null;
            });
          },

          setUnderlay: (underlay) => {
            set((state) => {
              state.underlay = underlay;
            });
          },

          setOtherStoreys: (patch) => {
            set((state) => {
              state.otherStoreys = { ...state.otherStoreys, ...patch };
            });
          },

          setShowBridges: (on) => {
            set((state) => {
              state.showBridges = on;
            });
          },

          setShowMap: (on) => {
            set((state) => {
              state.showMap = on;
            });
          },

          setCameraView: (view) => {
            set((state) => {
              state.cameraView = { view, nonce: state.cameraView.nonce + 1 };
              state.planView = false;
            });
          },

          toggleStoreyHidden: (storeyId) => {
            set((state) => {
              state.hiddenStoreys = state.hiddenStoreys.includes(storeyId)
                ? state.hiddenStoreys.filter((id) => id !== storeyId)
                : [...state.hiddenStoreys, storeyId];
            });
          },

          setMapOpacity: (opacity) => {
            set((state) => {
              state.mapOpacity = Math.min(1, Math.max(0.1, opacity));
            });
          },

          setTheme: (theme) => {
            set((state) => {
              state.theme = theme;
            });
          },

          setMeasurement: (measurement) => {
            set((state) => {
              state.measurement = measurement;
            });
          },

          setPresence: (presence) => {
            set((state) => {
              state.presence = presence;
            });
          },

          setFacadePhoto: (edge, photo) => {
            const previous = get().facadePhotos[edge];
            if (previous && previous.url !== photo?.url) URL.revokeObjectURL(previous.url);
            set((state) => {
              if (photo) state.facadePhotos[edge] = photo;
              else {
                state.facadePhotos = Object.fromEntries(
                  Object.entries(state.facadePhotos).filter(([key]) => Number(key) !== edge),
                );
              }
            });
          },

          setFloorPlanImage: (storeyId, image) => {
            const previous = get().floorPlanImages[storeyId];
            if (previous && previous.url !== image?.url) URL.revokeObjectURL(previous.url);
            set((state) => {
              if (image) state.floorPlanImages[storeyId] = image;
              else {
                state.floorPlanImages = Object.fromEntries(
                  Object.entries(state.floorPlanImages).filter(([key]) => key !== storeyId),
                );
              }
            });
          },

          clearProjectMedia: () => {
            const { facadePhotos, floorPlanImages } = get();
            for (const photo of [...Object.values(facadePhotos), ...Object.values(floorPlanImages)])
              URL.revokeObjectURL(photo.url);
            set((state) => {
              state.facadePhotos = {};
              state.floorPlanImages = {};
              state.photoWall = null;
            });
          },

          setFacadePhotoTransparency: (percent) => {
            set((state) => {
              state.facadePhotoTransparency = Math.min(100, Math.max(0, percent));
            });
          },

          setShowFacadePhotos: (on) => {
            set((state) => {
              state.showFacadePhotos = on;
            });
          },

          setPhotoWall: (edge) => {
            set((state) => {
              state.photoWall = edge;
            });
          },

          applyWallOpenings: (next, wallIndex) => {
            set((state) => {
              state.building = next;
              const storeyId = state.activeStoreyId ?? next.storeys[0]?.id;
              state.selection = storeyId ? { kind: "wall", storeyId, wallIndex } : null;
              Object.assign(state, clampUiState(next, state));
            });
          },

          addNote: (target, text, author) => {
            const id = createId("note");
            set((state) => {
              state.building.notes ??= [];
              state.building.notes.push({
                id,
                target,
                text: text.trim().slice(0, 4000),
                author,
                createdAt: new Date().toISOString(),
              });
            });
            return id;
          },

          setNoteDone: (id, done) => {
            set((state) => {
              const note = state.building.notes?.find((n) => n.id === id);
              if (!note) return;
              if (done) note.done = true;
              else delete note.done;
            });
          },

          removeNote: (id) => {
            set((state) => {
              if (!state.building.notes) return;
              state.building.notes = state.building.notes.filter((n) => n.id !== id);
            });
          },

          setHistoryPreview: (preview) => {
            set((state) => {
              state.historyPreview = preview;
            });
          },

          patchPresence: (clientId, patch) => {
            set((state) => {
              const entry = state.presence.find((p) => p.clientId === clientId);
              if (entry) Object.assign(entry, patch);
            });
          },

          setFacadeColor: (color) => {
            set((state) => {
              if (color) state.building.facadeColor = color;
              else delete state.building.facadeColor;
            });
          },

          setProjectInfo: (patch) => {
            set((state) => {
              // An undefined value clears the fact (the stage back to automatic); JSON drops it.
              state.building.project = JSON.parse(
                JSON.stringify({ ...state.building.project, ...patch }),
              ) as ProjectInfo;
            });
          },

          setProjectId: (projectId) => {
            set((state) => {
              state.projectId = projectId;
              if (projectId === null) state.projectRole = null;
            });
          },

          setProjectRole: (role) => {
            set((state) => {
              state.projectRole = role;
              // Losing edit rights mid-drawing drops the drawing tool.
              if (!toolAllowed(state.tool, role)) state.tool = "select";
            });
          },

          setFollowing: (clientId) => {
            set((state) => {
              state.following = clientId;
            });
          },

          setLastSeenAt: (at) => {
            set((state) => {
              state.lastSeenAt = at;
            });
          },

          applyRemoteBuilding: (building, rebase) => {
            // withoutHistory, past and future belong to the history slice wrapped around this
            // initializer. The snapshots are rebased outside the draft, as plain values.
            const current = get() as unknown as EditorStore;
            const past = rebase ? current.past.map(rebase) : rebase === null ? [] : current.past;
            const future = rebase ? current.future.map(rebase) : [];
            current.withoutHistory(() => {
              set((state) => {
                const next = localizeBuilding(building, state.language);
                const ui = clampUiState(next, state);
                state.building = next;
                Object.assign(state, ui);
                const history = state as unknown as { past: Building[]; future: Building[] };
                history.past = past;
                history.future = future;
              });
            });
          },

          setRenovatedView: (on) => {
            set((state) => {
              state.renovatedView = on;
              state.viewScenarioId = on ? "full-envelope" : null;
            });
          },

          setViewScenario: (id) => {
            set((state) => {
              state.viewScenarioId = id;
              state.renovatedView = id === "full-envelope";
            });
          },

          addScenario: (name, from) => {
            const id = createId("scenario");
            set((state) => {
              state.building.scenarios ??= [];
              state.building.scenarios.push({
                id,
                name,
                overrides: { ...from?.overrides },
                bridgeDetail: from?.bridgeDetail,
                roof: from?.roof,
                ...(from?.heating ? { heating: { ...from.heating } } : {}),
              });
            });
            return id;
          },

          updateScenario: (id, patch) => {
            set((state) => {
              const s = state.building.scenarios?.find((x) => x.id === id);
              if (!s) return;
              if (patch.name !== undefined) s.name = patch.name;
              if (patch.overrides !== undefined) s.overrides = { ...patch.overrides };
              if ("bridgeDetail" in patch) s.bridgeDetail = patch.bridgeDetail;
              if ("roof" in patch) s.roof = patch.roof;
              if ("heating" in patch) {
                if (patch.heating) s.heating = { ...patch.heating };
                else delete s.heating;
              }
            });
          },

          removeScenario: (id) => {
            set((state) => {
              if (!state.building.scenarios) return;
              state.building.scenarios = state.building.scenarios.filter((x) => x.id !== id);
              if (state.viewScenarioId === id) state.viewScenarioId = null;
            });
          },

          setActiveZone: (zoneId) => {
            set((state) => {
              state.activeZoneId = zoneId;
            });
          },

          setShowGrid: (show) => {
            set((state) => {
              state.showGrid = show;
            });
          },

          setTool: (tool) => {
            set((state) => {
              if (!toolAllowed(tool, state.projectRole)) return;
              state.tool = tool;
              // The zones to paint with are listed with the building, shown when nothing is
              // picked; a picked zone stays, it is the one being painted with.
              if (tool === "zone" && state.selection?.kind !== "zone") state.selection = null;
            });
          },

          setLanguage: (language) => {
            (get() as unknown as EditorStore).withoutHistory(() => {
              set((state) => {
                state.building = localizeBuilding(state.building, language);
                const historyState = state as unknown as HistorySlice;
                historyState.past = historyState.past.map((building) =>
                  localizeBuilding(building, language),
                );
                historyState.future = historyState.future.map((building) =>
                  localizeBuilding(building, language),
                );
                state.language = language;
              });
            });
          },
        };
      }),
    ),
  );
}

const startLanguage = loadLanguage() ?? detectLanguage();
export const useEditorStore = createEditorStore({
  language: startLanguage,
  building: initialBuilding() ?? undefined,
  theme: loadTheme() ?? "light",
});
