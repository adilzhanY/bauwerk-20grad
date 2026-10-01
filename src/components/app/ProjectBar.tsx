import { SaveProjectButton } from "@/components/shared/SaveProjectButton";
import { useMemo } from "react";
import { ArrowLeft, Check, CircleCheck, RotateCcw } from "lucide-react";
import { cx } from "@/components/shared/cx";
import { CustomButton } from "@/components/shared/CustomButton";
import { projectSummary } from "@/geometry/project";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { EnergyClassBadge } from "@/components/shared/EnergyClassBadge";
import { useEditorStore } from "@/store/building";
import type { Route } from "@/app/router";
import { useRouter } from "@/app/router";

const STEPS: { page: Route["page"]; label: MessageKey }[] = [
  { page: "building", label: "project.step.survey" },
  { page: "editor", label: "project.step.model" },
  { page: "variants", label: "project.step.variants" },
  { page: "report", label: "project.step.report" },
];

/**
 * Inside a project: the way back to the Projects page, the building, its energy class, and the
 * four steps, Survey, Model, Variants, Report. A step done shows a check; the stage the card
 * shows follows the steps, and "Mark as done" (or "Reopen") is the one thing set by hand.
 */
export function ProjectBar() {
  const t = useT();
  const route = useRouter((s) => s.route);
  const navigate = useRouter((s) => s.navigate);
  const building = useEditorStore((s) => s.building);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);
  const summary = useMemo(() => projectSummary(building), [building]);
  const gid = building.project?.gid;

  const go = (page: Route["page"]) => {
    if (page === "building") {
      if (gid) navigate({ page: "building", gid });
    } else navigate({ page });
  };

  return (
    <nav
      aria-label={t("project.steps")}
      className="relative z-10 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-paper px-4"
    >
      <button
        type="button"
        onClick={() => {
          navigate({ page: "projects" }, { query: "" });
        }}
        className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-muted hover:bg-panel hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden />
        {t("projects.title")}
      </button>
      <span aria-hidden className="h-6 w-px bg-line" />
      <span className="max-w-72 truncate text-sm font-semibold text-ink">{summary.title}</span>
      <EnergyClassBadge value={summary.energyClass} />
      <ol className="mx-auto flex items-center gap-1.5">
        {STEPS.map((step, i) => {
          const active = route.page === step.page;
          const done = summary.steps[i] ?? false;
          const disabled = step.page === "building" && !gid;
          return (
            <li key={step.page}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                onClick={() => {
                  go(step.page);
                }}
                className={cx(
                  "flex h-8 items-center gap-2 rounded-control border px-3 text-sm transition-colors disabled:opacity-40",
                  active
                    ? "border-select font-semibold text-select"
                    : "border-line text-ink hover:bg-panel",
                )}
              >
                <span
                  className={cx(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                    done
                      ? "bg-ok text-white"
                      : active
                        ? "bg-select text-white"
                        : "bg-line text-muted",
                  )}
                >
                  {done ? <Check size={12} aria-hidden /> : i + 1}
                </span>
                {t(step.label)}
              </button>
            </li>
          );
        })}
      </ol>
      <SaveProjectButton />
      {summary.stage === "done" ? (
        <CustomButton
          icon={<RotateCcw size={15} aria-hidden />}
          title={t("project.reopenHint")}
          onClick={() => {
            setProjectInfo({ stage: undefined });
          }}
        >
          {t("project.reopen")}
        </CustomButton>
      ) : (
        <CustomButton
          icon={<CircleCheck size={15} aria-hidden />}
          title={t("project.markDoneHint")}
          onClick={() => {
            setProjectInfo({ stage: "done" });
          }}
        >
          {t("project.markDone")}
        </CustomButton>
      )}
    </nav>
  );
}
