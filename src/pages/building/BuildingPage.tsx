import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bookmark, Box, MessageSquare, Share2 } from "lucide-react";
import type { Neighbour } from "lod2-core/api";
import { utmToLatLon } from "lod2-core/survey";
import { useRouter } from "@/app/router";
import { cx } from "@/components/cx";
import { useT } from "@/i18n/useT";
import { analyzePart, partsWithGeometry } from "@/lod2/analysis";
import { fetchNeighbours } from "@/lod2/api/client";
import { reverseAddress } from "@/lod2/api/geocode";
import type { Place } from "@/lod2/api/geocode";
import { useStore } from "@/lod2/state/store";
import { surveyOf, useSurvey } from "@/lod2/state/survey";
import { PhotoEditor } from "@/lod2/ui/photo-editor/PhotoEditor";
import type { WallImage } from "@/lod2/ui/photo-editor/types";
import { CustomButton } from "@/lod2/components/CustomButton";
import { useSelectedSurface } from "@/lod2/state/selectedWall";
import { takeOverWall } from "@/lod2/applyWall";
import { useEditorStore } from "@/store/building";
import { BuildingView } from "./BuildingView";
import { EnergySection, GeneralSection, PlotSection } from "./sections";
import { FacadeSection, SelectedWallCard } from "./FacadeSection";
import { NotesPopover } from "./NotesPopover";
import { Tabs } from "./Tabs";
import { isBookmarked, toggleBookmark } from "./bookmarks";

/** Neighbours this close count for party walls. */
const NEIGHBOUR_BOX_M = 60;
const PLOT_TAB = "plot";

/**
 * The building page: the address, one tab per building part (and the plot), the energy data
 * of the unrenovated state, the building data, the facade survey, and the way into the
 * editor. The 3D model and the map fill the right side.
 */
export function BuildingPage({ gid }: { gid: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const loadBuilding = useEditorStore((s) => s.loadBuilding);
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
  const applyWallToEditor = (wallImage: WallImage | null) => {
    if (!result?.ok || surfaceIndex === null) return;
    const editor = useEditorStore.getState();
    const taken = takeOverWall(editor.building, result.analysis.building, surfaceIndex);
    if (!taken) return;
    if (taken.merged) {
      editor.applyWallOpenings(taken.building, taken.edge);
    } else {
      editor.loadBuilding(taken.building);
      const storeyId = taken.building.storeys[0]?.id;
      if (storeyId) editor.select({ kind: "wall", storeyId, wallIndex: taken.edge });
    }
    // The photo editor frees its own copy of the image when it closes; the wall keeps one.
    if (wallImage) {
      editor.setFacadePhoto(taken.edge, {
        url: URL.createObjectURL(wallImage.blob),
        width: wallImage.width,
        height: wallImage.height,
      });
    }
    closePhotoEditor();
    navigate({ page: "editor" });
  };

  const startPlanning = () => {
    if (!result?.ok) return;
    loadBuilding(result.analysis.building);
    navigate({ page: "editor" });
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
            <IconButton
              label={t("building.back")}
              onClick={() => {
                navigate({ page: "start" });
              }}
            >
              <ArrowLeft size={19} aria-hidden />
            </IconButton>
            <span className="flex-1" />
            <IconButton
              label={copied ? t("building.linkCopied") : t("building.share")}
              onClick={share}
            >
              <Share2 size={18} aria-hidden />
            </IconButton>
            <IconButton
              label={t("building.bookmark")}
              pressed={bookmarked}
              onClick={() => {
                setBookmarked(toggleBookmark(gid));
              }}
            >
              <Bookmark size={18} aria-hidden fill={bookmarked ? "currentColor" : "none"} />
            </IconButton>
          </header>
          {copied && (
            <p role="status" className="mt-1 text-right text-xs text-muted">
              {t("building.linkCopied")}
            </p>
          )}

          <h1 className="mt-6 text-2xl leading-tight font-semibold">{address?.main ?? gid}</h1>
          <p className="mt-1 text-sm text-faint">
            {address ? address.area || "Berlin" : (current?.functionLabel ?? t("building.loading"))}
          </p>

          {error && (
            <p className="mt-6 text-sm text-mark">
              {error.kind === "notFound"
                ? t("building.notFound")
                : t("building.loadFailed", { message: error.message })}
            </p>
          )}
          {loading && !current && (
            <p className="mt-6 text-sm text-muted">{t("building.loading")}</p>
          )}

          {current && (
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
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-paper via-paper/95 to-transparent px-10 pt-10 pb-6">
          <button
            type="button"
            disabled={!result?.ok}
            onClick={startPlanning}
            className="pointer-events-auto h-11 flex-1 rounded-control bg-select text-sm font-semibold text-white shadow-float transition-colors hover:bg-select-strong disabled:opacity-40"
          >
            {t("building.startPlanning")}
          </button>
          <div className="pointer-events-auto relative">
            <button
              type="button"
              aria-label={t("building.notes")}
              aria-expanded={notesOpen}
              onClick={() => {
                setNotesOpen(!notesOpen);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-control border border-line bg-paper text-ink shadow-float hover:bg-panel"
            >
              <MessageSquare size={18} aria-hidden />
            </button>
            {notesOpen && (
              <NotesPopover
                gid={gid}
                onClose={() => {
                  setNotesOpen(false);
                }}
              />
            )}
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
              applyWallToEditor(wallImage);
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

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "flex h-10 w-10 items-center justify-center rounded-control text-ink transition-colors hover:bg-paper",
        pressed && "bg-paper",
      )}
    >
      {children}
    </button>
  );
}
