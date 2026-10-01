import { EnergyClassBadge } from "@/components/shared/EnergyClassBadge";
import { Avatar } from "@/components/shared/Avatar";
import { Card } from "@/components/shared/Card";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { cx } from "@/components/shared/cx";
import type { ProjectStage, Vec2 } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import { cardPicture } from "@/projects/projects";
import type { ProjectCard } from "@/projects/projects";
import { useEditorStore } from "@/store/building";

/** The dot colour of each stage, from the design tokens. */
const STAGE_TONE: Record<ProjectStage, string> = {
  survey: "text-select",
  variants: "text-sun",
  report: "text-ok",
  done: "text-muted",
};

export function StageChip({ stage, overlay = false }: { stage: ProjectStage; overlay?: boolean }) {
  const t = useT();
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full text-xs font-semibold",
        overlay ? "bg-paper/95 px-2.5 py-0.5 shadow-soft" : "",
        STAGE_TONE[stage],
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="text-ink">{t(`project.stage.${stage}`)}</span>
    </span>
  );
}

/** The card picture: the project's facade photo or 3D view, else its footprint drawn on a plan. */
export function ProjectPicture({ card, className }: { card: ProjectCard; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void cardPicture(card.ref).then((u) => {
      made = u;
      if (alive) setUrl(u);
      else if (u) URL.revokeObjectURL(u);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [card.ref, card.updatedAt]);
  return url ? (
    <img src={url} alt="" draggable={false} className={cx("object-cover", className)} />
  ) : (
    <FootprintPicture footprint={card.summary.footprint} className={className} />
  );
}

/** The footprint on the site grid, fitted into the picture. */
function FootprintPicture({ footprint, className }: { footprint: Vec2[]; className?: string }) {
  if (footprint.length < 3) return <div className={cx("site-plan", className)} />;
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const size = Math.max(maxX - minX, maxY - minY, 1);
  const pad = size * 0.35;
  // Plan y points north, SVG y points down: flip it.
  const points = footprint.map((p) => `${String(p.x)},${String(-p.y)}`).join(" ");
  return (
    <div className={cx("site-plan", className)}>
      <svg
        viewBox={`${String(minX - pad)} ${String(-maxY - pad)} ${String(maxX - minX + 2 * pad)} ${String(maxY - minY + 2 * pad)}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        aria-hidden
      >
        <polygon
          points={points}
          className="fill-footprint stroke-footprint-line"
          strokeWidth={size / 60}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** One project as a card: picture, class, stage, address, use and client, steps, time. */
export function ProjectCardView({
  card,
  onOpen,
  onDelete,
}: {
  card: ProjectCard;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [confirming, setConfirming] = useState(false);
  const s = card.summary;
  const facts = [
    s.use,
    s.storeys > 0 ? t("project.storeys", { n: s.storeys }) : null,
    s.client,
  ].filter(Boolean);
  return (
    <Card
      as="article"
      elevation="raised"
      className="group relative flex min-w-0 flex-col overflow-hidden transition-shadow hover:shadow-float"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("project.openNamed", { name: s.title })}
        className="flex min-w-0 flex-1 flex-col text-left"
      >
        <span className="relative block aspect-[4/3] overflow-hidden bg-panel">
          <ProjectPicture card={card} className="h-full w-full" />
          <EnergyClassBadge
            value={s.energyClass}
            className="absolute top-2.5 right-2.5 shadow-soft"
          />
          <span className="absolute bottom-2.5 left-2.5">
            <StageChip stage={s.stage} overlay />
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-1 px-3.5 pt-3 pb-3.5">
          <span className="truncate text-[15px] font-semibold text-ink">{s.title}</span>
          <span className="truncate text-sm text-muted">{facts.join(" · ") || " "}</span>
          <StepBar steps={s.steps} />
          <CardPresence card={card} />
          <span className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
            <span>{t("project.edited", { when: formatRelative(card.updatedAt, language) })}</span>
            {card.owner && (
              <Avatar
                userId={card.owner.id}
                firstName={card.owner.firstName}
                lastName={card.owner.lastName}
                size="sm"
              />
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={confirming ? t("project.deleteConfirm") : t("project.delete")}
        title={confirming ? t("project.deleteConfirm") : t("project.delete")}
        onClick={() => {
          if (confirming) onDelete();
          else setConfirming(true);
        }}
        onBlur={() => {
          setConfirming(false);
        }}
        className={cx(
          "absolute top-2.5 left-2.5 flex h-8 items-center gap-1.5 rounded-control px-2 text-xs font-medium shadow-soft transition-opacity",
          confirming
            ? "bg-mark text-white opacity-100"
            : "bg-paper/95 text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-mark",
        )}
      >
        <Trash2 size={14} aria-hidden />
        {confirming && t("project.deleteConfirm")}
      </button>
    </Card>
  );
}

/** The four steps, Survey, Model, Variants, Report, as a thin bar. */
export function StepBar({ steps }: { steps: readonly boolean[] }) {
  const t = useT();
  const done = steps.filter(Boolean).length;
  return (
    <span
      className="mt-1.5 flex gap-1"
      role="img"
      aria-label={t("project.stepsDone", { n: done, total: steps.length })}
    >
      {steps.map((on, i) => (
        <span key={i} className={cx("h-1 flex-1 rounded-full", on ? "bg-select" : "bg-line")} />
      ))}
    </span>
  );
}

/**
 * Who is in the project right now, with their avatars, or else when the viewer was last in
 * it (TODO Part 21, CC.4). Nothing for a project in this browser.
 */
function CardPresence({ card }: { card: ProjectCard }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [first, ...more] = card.here;
  if (first) {
    const name = `${first.firstName} ${first.lastName}`;
    return (
      <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-ok">
        <span className="flex -space-x-1">
          {card.here.slice(0, 3).map((p) => (
            <Avatar
              key={p.userId}
              userId={p.userId}
              firstName={p.firstName}
              lastName={p.lastName}
              size="xs"
              ring
            />
          ))}
        </span>
        <span className="truncate">
          {more.length === 0
            ? t("presence.card.here", { name })
            : t("presence.card.hereMany", { name, count: more.length })}
        </span>
      </span>
    );
  }
  if (!card.lastSeenAt) return null;
  return (
    <span className="mt-1 truncate text-xs text-muted">
      {t("presence.card.lastHere", { when: formatRelative(card.lastSeenAt, language) })}
    </span>
  );
}
