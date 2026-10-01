import { syncProjectsView } from "@/auth/userData";
import { CustomChip } from "@/components/shared/CustomChip";
import { PageTitle } from "@/components/shared/PageTitle";
import { Card } from "@/components/shared/Card";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Plus, Search } from "lucide-react";
import { useRouter } from "@/app/router";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { cx } from "@/components/shared/cx";
import { PROJECT_STAGES } from "@/geometry/project";
import type { ProjectStage } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatNumber, formatRelative } from "@/lib/format";
import { deleteProjectCard, listProjectCards } from "@/projects/projects";
import { openProjectCard } from "@/projects/session";
import type { ProjectCard } from "@/projects/projects";
import { useEditorStore } from "@/store/building";
import { syncEnabled } from "@/sync/useSync";
import { SAMPLE_BUILDINGS } from "@/lib/sampleBuildings";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { EnergyClassBadge } from "@/components/shared/EnergyClassBadge";
import { ProjectCardView, ProjectPicture, StageChip } from "@/components/projects/ProjectCardView";
import { ProjectsMap } from "@/components/projects/ProjectsMap";
import { landingRoute, newProjectQuery } from "@/app/projectRoutes";

type View = "grid" | "list" | "map";
const VIEW_KEY = "bauwerk.projectsView";

function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "list" || v === "map" ? v : "grid";
  } catch {
    return "grid";
  }
}

/**
 * Where Bauwerk starts: the consultant's projects, one building each. Cards with a picture of
 * the building by default, a list or a map on request, filtered by stage and searched by
 * address, client or use. "New project" is the first card and the button at the top.
 */
export function ProjectsPage() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const navigate = useRouter((s) => s.navigate);
  const [cards, setCards] = useState<ProjectCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [stage, setStage] = useState<ProjectStage | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(savedView);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    listProjectCards()
      .then((list) => {
        setCards(list);
        setFailed(false);
      })
      .catch(() => {
        setCards([]);
        setFailed(true);
      });
  }, []);
  useEffect(load, [load]);

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // The choice is a convenience.
    }
    syncProjectsView(v);
  };

  const open = useCallback(
    (card: ProjectCard) => {
      setOpenFailed(false);
      void openProjectCard(card).then((result) => {
        // A server project is named in the address (?project=), so a reload or a copied
        // link opens it again; a project kept in this browser needs nothing there.
        if (result === "opened")
          navigate(landingRoute(card.summary), {
            query: card.ref.kind === "server" ? `?project=${encodeURIComponent(card.ref.id)}` : "",
          });
        else if (result === "failed") setOpenFailed(true);
      });
    },
    [navigate],
  );

  const remove = (card: ProjectCard) => {
    void deleteProjectCard(card).then(load);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cards ?? []).filter(
      (c) =>
        (stage === "all" || c.summary.stage === stage) &&
        (q === "" ||
          [c.summary.title, c.summary.client, c.summary.use, c.summary.gid].some((v) =>
            v?.toLowerCase().includes(q),
          )),
    );
  }, [cards, stage, query]);

  const count = (s: ProjectStage | "all") =>
    (cards ?? []).filter((c) => s === "all" || c.summary.stage === s).length;

  const startFromExample = (gid: string) => {
    navigate({ page: "building", gid }, { query: newProjectQuery({ name: "", client: "" }) });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-8 pt-8 pb-16">
        <header className="flex flex-wrap items-center gap-3">
          <PageTitle title={t("projects.title")} />
          <span className="flex-1" />
          <label className="flex h-10 w-80 items-center gap-2 rounded-control border border-line bg-paper px-3 focus-within:border-select">
            <Search size={15} aria-hidden className="text-muted" />
            <span className="sr-only">{t("projects.search")}</span>
            <input
              type="search"
              value={query}
              placeholder={t("projects.search")}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </label>
          <CustomButton
            variant="primary"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => {
              setCreating(true);
            }}
          >
            {t("projects.new")}
          </CustomButton>
        </header>

        <Presence show={!syncEnabled}>
          <Hint>{t("projects.localOnly")}</Hint>
        </Presence>
        <Presence show={failed}>
          <p className="text-sm text-mark">{t("projects.loadFailed")}</p>
        </Presence>
        <Presence show={openFailed}>
          <Hint error>{t("projects.openFailed")}</Hint>
        </Presence>

        {cards !== null && cards.length === 0 && !failed ? (
          <EmptyProjects
            onNew={() => {
              setCreating(true);
            }}
            onExample={startFromExample}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {(["all", ...PROJECT_STAGES] as const).map((s) => (
                <CustomChip
                  key={s}
                  pressed={stage === s}
                  onClick={() => {
                    setStage(s);
                  }}
                >
                  {s === "all" ? t("projects.all") : t(`project.stage.${s}`)}
                  <b className="ml-1.5 font-semibold">{count(s)}</b>
                </CustomChip>
              ))}
              <span className="flex-1" />
              <span className="text-xs text-muted">{t("projects.sorted")}</span>
              {/* Its own width, so the row never squeezes the labels. */}
              <div className="shrink-0">
                <CustomSegmented
                  label={t("projects.view")}
                  value={view}
                  options={[
                    { value: "grid", label: t("projects.grid") },
                    { value: "list", label: t("projects.list") },
                    { value: "map", label: t("projects.map") },
                  ]}
                  onChange={chooseView}
                />
              </div>
            </div>

            {cards === null ? (
              <p className="text-sm text-muted">{t("projects.loading")}</p>
            ) : view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(true);
                  }}
                  className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line-strong p-6 text-center text-muted transition-colors hover:bg-paper"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-select-soft text-select">
                    <Plus size={22} aria-hidden />
                  </span>
                  <span className="font-semibold text-ink">{t("projects.new")}</span>
                  <span className="text-sm">{t("projects.newHint")}</span>
                </button>
                {shown.map((card) => (
                  <ProjectCardView
                    key={card.buildingId + (card.ref.kind === "server" ? card.ref.id : "")}
                    card={card}
                    onOpen={() => {
                      open(card);
                    }}
                    onDelete={() => {
                      remove(card);
                    }}
                  />
                ))}
              </div>
            ) : view === "list" ? (
              <ProjectTable cards={shown} onOpen={open} language={language} />
            ) : (
              <Card className="grid h-[560px] grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] overflow-hidden">
                <ProjectsMap
                  cards={shown}
                  selected={selected}
                  onSelect={(card) => {
                    setSelected(card.buildingId);
                  }}
                />
                <ul className="flex flex-col overflow-y-auto border-l border-line">
                  {shown.map((card) => (
                    <li key={card.buildingId}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selected === card.buildingId) open(card);
                          else setSelected(card.buildingId);
                        }}
                        onDoubleClick={() => {
                          open(card);
                        }}
                        className={cx(
                          "grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-3 text-left",
                          selected === card.buildingId ? "bg-select-soft" : "hover:bg-panel",
                        )}
                      >
                        <ProjectPicture card={card} className="h-12 w-16 rounded-soft" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ink">
                            {card.summary.title}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {t(`project.stage.${card.summary.stage}`)} ·{" "}
                            {formatRelative(card.updatedAt, language)}
                          </span>
                        </span>
                        <EnergyClassBadge value={card.summary.energyClass} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Presence show={cards !== null && cards.length > 0 && shown.length === 0}>
              <p className="text-sm text-muted">{t("projects.noMatch")}</p>
            </Presence>
          </>
        )}
      </div>
      <Presence show={creating} kind="float">
        <NewProjectDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      </Presence>
    </div>
  );
}

function ProjectTable({
  cards,
  onOpen,
  language,
}: {
  cards: ProjectCard[];
  onOpen: (card: ProjectCard) => void;
  language: "en" | "de";
}) {
  const t = useT();
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="px-3 py-2.5 font-medium">
              <span className="sr-only">{t("projects.picture")}</span>
            </th>
            <th className="px-3 py-2.5 font-medium">{t("projects.building")}</th>
            <th className="px-3 py-2.5 font-medium">{t("projects.client")}</th>
            <th className="px-3 py-2.5 font-medium">{t("projects.stage")}</th>
            <th className="px-3 py-2.5 font-medium">{t("projects.class")}</th>
            <th className="px-3 py-2.5 text-right font-medium">kWh/(m²a)</th>
            <th className="px-3 py-2.5 font-medium">{t("projects.edited")}</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            // The title button covers the whole row, so the row opens on a click and Tab
            // reaches it once.
            <tr
              key={card.buildingId}
              className="relative border-b border-line last:border-0 hover:bg-panel"
            >
              <td className="px-3 py-2">
                <ProjectPicture card={card} className="h-10 w-14 rounded-soft" />
              </td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpen(card);
                  }}
                  className="text-left font-semibold text-ink after:absolute after:inset-0 hover:underline"
                >
                  {card.summary.title}
                </button>
                {card.summary.use && <div className="text-xs text-muted">{card.summary.use}</div>}
              </td>
              <td className="px-3 py-2 text-muted">{card.summary.client ?? ""}</td>
              <td className="px-3 py-2">
                <StageChip stage={card.summary.stage} />
              </td>
              <td className="px-3 py-2">
                <EnergyClassBadge value={card.summary.energyClass} />
              </td>
              <td className="px-3 py-2 text-right font-num">
                {formatNumber(card.summary.endEnergy, language, 0)}
              </td>
              <td className="px-3 py-2 text-xs text-muted">
                {formatRelative(card.updatedAt, language)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** The very first visit: what a project is, and a way in. */
function EmptyProjects({
  onNew,
  onExample,
}: {
  onNew: () => void;
  onExample: (gid: string) => void;
}) {
  const t = useT();
  return (
    <Card className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 px-8 py-10 text-center">
      <span className="flex h-13 w-13 items-center justify-center rounded-full bg-select-soft text-select">
        <FolderOpen size={24} aria-hidden />
      </span>
      <h2 className="text-lg font-semibold">{t("projects.emptyTitle")}</h2>
      <p className="text-sm text-muted">{t("projects.emptyText")}</p>
      <CustomButton variant="primary" icon={<Plus size={16} aria-hidden />} onClick={onNew}>
        {t("projects.new")}
      </CustomButton>
      <Hint className="mt-2">{t("projects.orExample")}</Hint>
      <div className="flex flex-wrap justify-center gap-2">
        {SAMPLE_BUILDINGS.map((example) => (
          <CustomChip
            key={example.gid}
            onClick={() => {
              onExample(example.gid);
            }}
          >
            {example.street}
          </CustomChip>
        ))}
      </div>
    </Card>
  );
}
