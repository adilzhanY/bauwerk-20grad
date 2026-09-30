import { PageTitle } from "@/components/shared/PageTitle";
import { Presence } from "@/components/shared/Presence";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Box, MessageSquare, Share2 } from "lucide-react";
import type { Neighbour } from "lod2-core/api";
import { utmToLatLon } from "lod2-core/survey";
import { useRouter } from "@/app/router";
import { useT } from "@/i18n/useT";
import { analyzePart, partsWithGeometry } from "@/lod2/analysis";
import { fetchNeighbours } from "@/lod2/api/client";
import { reverseAddress } from "@/lod2/api/geocode";
import type { Place } from "@/lod2/api/geocode";
import { useStore } from "@/lod2/state/store";
import { surveyOf, useSurvey } from "@/lod2/state/survey";
import { PhotoEditor } from "@/components/photo-editor/PhotoEditor";
import type { WallImage } from "@/components/photo-editor/types";
import { CustomButton } from "@/components/shared/CustomButton";
import { useSelectedSurface } from "@/lod2/state/selectedWall";
import { surveyedEdge, takeOverWall } from "@/lod2/applyWall";
import { openForWork } from "@/projects/session";
import type { Opening as PhotoOpening } from "lod2-core/openings";
import { facadeColourOf } from "@/lib/wallColor";
import { WALL_PX_PER_METRE } from "@/components/photo-editor/constants";
import { withProject } from "@/projects/projects";
import type { Building } from "@/geometry/types";
import { readNewProject } from "@/app/projectRoutes";
import { useEditorStore } from "@/store/building";
import { BuildingView } from "@/components/building/BuildingView";
import { EnergySection, GeneralSection, PlotSection } from "@/components/building/sections";
import { FacadeSection, SelectedWallCard } from "@/components/building/FacadeSection";
import { NotesPopover } from "@/components/building/NotesPopover";
import { Tabs } from "@/components/building/Tabs";
import { isBookmarked, toggleBookmark } from "@/components/building/bookmarks";

/** Neighbours this close count for party walls. */
const NEIGHBOUR_BOX_M = 60;
const PLOT_TAB = "plot";

/**
 * The building page: the address, one tab per building part (and the plot), the energy data
 * of the unrenovated state, the building data, the facade survey, and the way into the
 * editor. The 3D model and the map fill the right side.
 */
/** Every wall of the building in the editor takes the colour of the photographed facade. */
function paintFacade(wallImage: WallImage | null, openings: readonly PhotoOpening[]) {
  if (!wallImage) return;
  void facadeColourOf(wallImage, openings, WALL_PX_PER_METRE).then((colour) => {
    if (colour) useEditorStore.getState().setFacadeColor(colour);
  });
}

export function BuildingPage({ gid }: { gid: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const navigate = useRouter((s) => s.navigate);
  const select = useStore((s) => s.select);
  const selectedGid = useStore((s) => s.selectedGid);
  const detail = useStore((s) => s.building);
  const loading = useStore((s) => s.loadingBuilding);
  const error = useStore((s) => s.error);
  const survey = useSurvey((s) => surveyOf(s.buildings, gid));
  const [neighbours, setNeighbours] = useState<Neighbour[]>([]);
  const [address, setAddress] = useState<Place | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [bookmarked, setBookmarked] = useState(() => isBookmarked(gid));
  const [copied, setCopied] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // A new project asked for in the address (the New project dialog, the map, an example).
  const newProject = useRef(readNewProject(window.location.search));
  const projectOpen = useEditorStore((s) => s.building.project?.gid === gid);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);

  // The page's building drives the LoD2 store, which the 3D view and the photo editor read.
  useEffect(() => {
    if (selectedGid !== gid) select(gid);
  }, [gid, selectedGid, select]);

  const current = detail?.buildingGid === gid ? detail : null;
  const parts = useMemo(() => (current ? partsWithGeometry(current) : []), [current]);

  useEffect(() => {
    const controller = new AbortController();
    fetchNeighbours(gid, NEIGHBOUR_BOX_M, controller.signal)
      .then(setNeighbours)
      .catch(() => {
        // Without neighbours there are no party walls; the page still works.
      });
    return () => {
      controller.abort();
    };
  }, [gid]);

  // The address from the building's position, since Berlin's data has none.
  useEffect(() => {
    const origin = parts[0]?.mesh?.origin;
    if (!origin) return;
    const controller = new AbortController();
    const [easting, northing] = origin;
    const { lat, lon } = utmToLatLon(easting, northing, 33);
    reverseAddress(lon, lat, controller.signal)
      .then(setAddress)
      .catch(() => {
        // The Gebäude-ID stays the title.
      });
    return () => {
      controller.abort();
    };
  }, [parts]);

  // The part to show: the chosen tab, else the surveyed part, else the largest.
  const surveyedPart = Object.values(survey.walls)[0]?.partGid;
  const partGid =
    tab && tab !== PLOT_TAB && parts.some((p) => p.gid === tab)
      ? tab
      : (parts.find((p) => p.gid === surveyedPart)?.gid ?? parts[0]?.gid ?? null);
  const activeTab = tab === PLOT_TAB ? PLOT_TAB : partGid;

  const result = useMemo(
    () => (current && partGid ? analyzePart(current, partGid, survey, neighbours, language) : null),
    [current, partGid, survey, neighbours, language],
  );

  // "Apply to 3D model" in the photo editor: this facade's openings onto its wall in the
  // editor, and the straightened photo on it. The survey already holds the openings.
  const surface = useSelectedSurface();
  const surfaceIndex = surface?.kind === "wall" ? surface.ref.surfaceIndex : null;
  const closePhotoEditor = useStore((s) => s.closePhotoEditor);
  /** The survey's building with what the Projects page shows about it. */
  const withFacts = (building: Building): Building =>
    withProject(building, { gid, ...(address ? { address: address.main } : {}) });

  // The new project, once the building's data is there: created, and the address cleaned.
  useEffect(() => {
    const request = newProject.current;
    if (!request || !result?.ok) return;
    const { name, client } = request;
    newProject.current = null;
    const named = (b: Building): Building =>
      withProject({ ...withFacts(b), name: name || b.name }, client ? { client } : {});
    // Always a new project: nothing of an earlier project of this house comes along.
    void openForWork(named(result.analysis.building), named, { fresh: true });
    const params = new URLSearchParams(window.location.search);
    for (const key of ["neu", "name", "kunde"]) params.delete(key);
    const rest = params.toString();
    navigate({ page: "building", gid }, { replace: true, query: rest ? `?${rest}` : "" });
    // `withFacts` reads the address, which may come later; the effect below fills it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, gid, navigate]);

  // The address arrives after the building: give it to this building's project.
  useEffect(() => {
    const known = useEditorStore.getState().building.project?.address;
    if (projectOpen && address?.main && known !== address.main)
      setProjectInfo({ address: address.main });
  }, [projectOpen, address, setProjectInfo]);

  const applyWallToEditor = async (
    wallImage: WallImage | null,
    photoOpenings: readonly PhotoOpening[],
  ) => {
    if (!result?.ok || surfaceIndex === null) return;
    const survey = withFacts(result.analysis.building);
    const edge = surveyedEdge(survey, surfaceIndex);
    if (edge === null) return;
    const editor = useEditorStore.getState();
    const taken = takeOverWall(editor.building, survey, surfaceIndex);
    // The photo editor frees its own copy of the image when it closes; the wall keeps one.
    const photo = wallImage && {
      url: URL.createObjectURL(wallImage.blob),
      width: wallImage.width,
      height: wallImage.height,
    };
    closePhotoEditor();
    if (taken?.merged) {
      editor.applyWallOpenings(taken.building, taken.edge);
      if (photo) editor.setFacadePhoto(edge, photo);
      navigate({ page: "editor" });
      paintFacade(wallImage, photoOpenings);
      return;
    }
    // Another building is open: a project of this one takes the wall, never the one open
    // before, which is left first (asking to save it when it is not).
    const entered = await openForWork(
      survey,
      (existing) => takeOverWall(existing, survey, surfaceIndex)?.building ?? existing,
    );
    if (!entered) {
      if (photo) URL.revokeObjectURL(photo.url);
      return;
    }
    navigate({ page: "editor" });
    const opened = useEditorStore.getState();
    const storeyId = opened.building.storeys[0]?.id;
    if (storeyId) opened.select({ kind: "wall", storeyId, wallIndex: edge });
    if (photo) opened.setFacadePhoto(edge, photo);
    paintFacade(wallImage, photoOpenings);
  };

  const startPlanning = () => {
    if (!result?.ok) return;
    // This house's project goes on when it is the one open; otherwise a new one starts,
    // after asking to save the work open before.
    void openForWork(withFacts(result.analysis.building), withFacts).then((opened) => {
      if (opened) navigate({ page: "editor" });
    });
  };

  const share = () => {
    void navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    });
  };

  const partName = (index: number) =>
    parts.length === 1
      ? shortUse(current?.functionLabel, t("building.part"))
      : `${shortUse(current?.functionLabel, t("building.part"))} ${String(index + 1)}`;
  const tabs = [
    { id: PLOT_TAB, label: t("building.plot") },
    ...parts.map((p, i) => ({ id: p.gid, label: partName(i) })),
  ];

  return (
    <div className="grid h-full grid-cols-[minmax(460px,36%)_1fr]">
      <section className="relative flex min-h-0 flex-col border-r border-line bg-paper">
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-8 pb-32">
          <header className="flex items-center gap-2">
            <CustomIconButton
              size="lg"
              label={t("building.back")}
              onClick={() => {
                navigate({ page: projectOpen ? "projects" : "map" }, { query: "" });
              }}
            >
              <ArrowLeft size={19} aria-hidden />
            </CustomIconButton>
            <span className="flex-1" />
            <CustomIconButton
              size="lg"
              label={copied ? t("building.linkCopied") : t("building.share")}
              onClick={share}
            >
              <Share2 size={18} aria-hidden />
            </CustomIconButton>
            <CustomIconButton
              size="lg"
              label={t("building.bookmark")}
              pressed={bookmarked}
              onClick={() => {
                setBookmarked(toggleBookmark(gid));
              }}
            >
              <Bookmark size={18} aria-hidden fill={bookmarked ? "currentColor" : "none"} />
            </CustomIconButton>
          </header>
          <Presence show={copied}>
            <p role="status" className="mt-1 text-right text-xs text-muted">
              {t("building.linkCopied")}
            </p>
          </Presence>

          <PageTitle
            className="mt-6"
            title={address?.main ?? gid}
            subtitle={
              address ? address.area || "Berlin" : (current?.functionLabel ?? t("building.loading"))
            }
          />

          <Presence value={error}>
            {(error) => (
              <p className="mt-6 text-sm text-mark">
                {error.kind === "notFound"
                  ? t("building.notFound")
                  : t("building.loadFailed", { message: error.message })}
              </p>
            )}
          </Presence>
          <Presence show={loading && !current}>
            <p className="mt-6 text-sm text-muted">{t("building.loading")}</p>
          </Presence>

          <Presence value={current}>
            {(current) => (
              <>
                <div className="mt-7">
                  <Tabs
                    label={t("building.parts")}
                    tabs={tabs}
                    value={activeTab ?? PLOT_TAB}
                    onChange={setTab}
                    moreLabel={t("building.moreParts")}
                  />
                </div>
                {activeTab === PLOT_TAB ? (
                  <PlotSection detail={current} parts={parts} />
                ) : result?.ok ? (
                  <>
                    {/* Under the tabs while a wall is picked, and pinned flush to the top of the panel
                        once the page scrolls (-top-8 undoes the panel's pt-8), so the survey
                        buttons never need scrolling to. */}
                    <div className="sticky -top-8 z-10 -mx-10 bg-gradient-to-b from-paper from-85% to-transparent px-10 pt-4 pb-3 empty:hidden">
                      <SelectedWallCard />
                    </div>
                    <EnergySection analysis={result.analysis} />
                    <GeneralSection
                      detail={current}
                      partGid={partGid}
                      analysis={result.analysis}
                      survey={survey}
                    />
                    <FacadeSection gid={gid} partGid={partGid} />
                  </>
                ) : (
                  result && <p className="mt-6 text-sm text-mark">{result.reason}</p>
                )}
              </>
            )}
          </Presence>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-paper via-paper/95 to-transparent px-10 pt-10 pb-6">
          <CustomButton
            variant="primary"
            size="lg"
            disabled={!result?.ok}
            onClick={startPlanning}
            className="pointer-events-auto flex-1 shadow-float"
          >
            {t("building.startPlanning")}
          </CustomButton>
          <div className="pointer-events-auto relative">
            <CustomIconButton
              label={t("building.notes")}
              size="lg"
              variant="floating"
              pressed={notesOpen}
              aria-expanded={notesOpen}
              onClick={() => {
                setNotesOpen(!notesOpen);
              }}
            >
              <MessageSquare size={18} aria-hidden />
            </CustomIconButton>
            <Presence show={notesOpen} kind="float">
              <NotesPopover
                gid={gid}
                onClose={() => {
                  setNotesOpen(false);
                }}
              />
            </Presence>
          </div>
        </div>
      </section>
      <BuildingView gid={gid} />
      <PhotoEditor
        renderAction={(openings, _photoName, wallImage) => (
          <CustomButton
            variant="primary"
            icon={<Box size={15} aria-hidden />}
            disabled={openings.length === 0 || !result?.ok || surfaceIndex === null}
            onClick={() => {
              void applyWallToEditor(wallImage, openings);
            }}
          >
            {t("wallPhoto.apply")}
          </CustomButton>
        )}
      />
    </div>
  );
}

/** "Wohnhaus" from an ALKIS function label such as "Wohnhaus" or "Wohngebäude mit Handel". */
function shortUse(label: string | null | undefined, fallback: string): string {
  if (!label) return fallback;
  const first = label.split(/[ ,(]/)[0] ?? label;
  return first.length > 2 ? first : label;
}
