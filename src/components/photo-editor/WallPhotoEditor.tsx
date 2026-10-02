import { shareActivity } from "@/sync/activity";
import { useMemo } from "react";
import { Box } from "lucide-react";
import type { Opening as PhotoOpening } from "lod2-core/openings";
import type { MeasuredOpening, PlacedOpening } from "lod2-core/survey";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { planWallOpenings, wallPlaneFor } from "@/geometry/photoWall";
import type { ChangeKind, WallPlan } from "@/geometry/photoWall";
import type { ValueSource } from "@/geometry/types";
import { computeEnergy } from "@/geometry/energy";
import type { EnergySummary } from "@/geometry/energy";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomSection } from "@/components/shared/CustomField";
import { PhotoEditorView } from "@/components/photo-editor/PhotoEditor";
import { WALL_PX_PER_METRE } from "@/components/photo-editor/constants";
import { facadeColourOf } from "@/lib/wallColor";
import type { WallGeometry } from "@/components/photo-editor/useWallGeometry";

/** The placement explains itself in German (lod2-core); these are the words in both languages. */
const PLACEMENT_WORDS: Record<string, MessageKey> = {
  "liegt außerhalb der Grundrisskante": "wallPhoto.reason.outside",
  "liegt über der Traufe": "wallPhoto.reason.aboveEaves",
  "zu niedrig nach dem Zuschnitt auf das Geschoss": "wallPhoto.reason.tooLow",
  "überlappt eine sicherere Öffnung": "wallPhoto.reason.overlaps",
  "an der Wandkante gekürzt": "wallPhoto.note.wallEnd",
  "an der Geschossdecke gekürzt": "wallPhoto.note.slab",
  "Tür über dem Fußboden als Fenster übernommen": "wallPhoto.note.doorAsWindow",
  "wegen Überlappung gekürzt": "wallPhoto.note.overlap",
};

const CHANGE_ORDER: ChangeKind[] = ["added", "moved", "removed", "kept"];

function measured(openings: readonly PhotoOpening[]): MeasuredOpening[] {
  return openings.map((o) => ({
    kind: o.kind ?? "window",
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    ...(o.score === undefined ? {} : { score: o.score }),
  }));
}

/**
 * The photo editor for one facade of the building in the 3D editor, opened from the wall's
 * properties. What it measures is shown as changes to the model, storey by storey, and one
 * click puts them on the wall, as one undo step.
 */
export function WallPhotoEditor() {
  const t = useT();
  const edge = useEditorStore((s) => s.photoWall);
  const building = useEditorStore((s) => s.building);
  const setPhotoWall = useEditorStore((s) => s.setPhotoWall);
  const applyWallOpenings = useEditorStore((s) => s.applyWallOpenings);
  const setFacadePhoto = useEditorStore((s) => s.setFacadePhoto);
  const setFacadeColor = useEditorStore((s) => s.setFacadeColor);

  const wall = useMemo<WallGeometry>(() => {
    const plane = edge === null ? null : wallPlaneFor(building, edge);
    return {
      ring: null,
      plane,
      // The model stands on the ground: the photo's wall starts at the floor of the ground storey.
      groundZ: 0,
      buriedDepth: 0,
      area: plane ? plane.width * plane.height : 0,
      facing: plane?.azimuth ?? null,
    };
  }, [building, edge]);

  const close = () => {
    setPhotoWall(null);
  };

  const plan = (openings: readonly PhotoOpening[], photoName: string | null): WallPlan | null => {
    if (edge === null) return null;
    const source = (placed: PlacedOpening): ValueSource => {
      const how =
        placed.score === undefined
          ? t("wallPhoto.source.drawn")
          : t("wallPhoto.source.detected", { confidence: Math.round(placed.score * 100) });
      return photoName
        ? { kind: "photo", note: how, photo: photoName }
        : { kind: "photo", note: how };
    };
    return planWallOpenings(building, edge, measured(openings), source);
  };

  return (
    <PhotoEditorView
      open={edge !== null}
      onClose={close}
      wall={wall}
      renderSide={(openings, photoName) => (
        <WallChanges plan={plan(openings, photoName)} count={openings.length} />
      )}
      renderAction={(openings, photoName, wallImage) => {
        const next = plan(openings, photoName);
        const changed = next?.changes.some((c) => c.change !== "kept") ?? false;
        return (
          <CustomButton
            variant="primary"
            icon={<Box size={15} aria-hidden />}
            disabled={!next || !changed}
            onClick={() => {
              if (!next || edge === null) return;
              applyWallOpenings(next.building, edge);
              shareActivity({ kind: "facade", wallIndex: edge, count: openings.length });
              // Every wall takes the colour of the photographed facade.
              if (wallImage) {
                void facadeColourOf(wallImage, openings, WALL_PX_PER_METRE).then((colour) => {
                  if (colour) setFacadeColor(colour);
                });
              }
              // The editor frees its own copy of the image when it closes; the wall keeps one.
              if (wallImage) {
                setFacadePhoto(edge, {
                  url: URL.createObjectURL(wallImage.blob),
                  width: wallImage.width,
                  height: wallImage.height,
                });
              }
              close();
            }}
          >
            {t("wallPhoto.apply")}
          </CustomButton>
        );
      }}
    />
  );
}

/** What applying would do to the model, storey by storey, and what could not be placed. */
function WallChanges({ plan, count }: { plan: WallPlan | null; count: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const storeys = building.storeys;
  // What the photo is worth: the opening area and the heating demand, now and after.
  const before = useMemo(() => computeEnergy(building), [building]);
  const after = useMemo(() => (plan ? computeEnergy(plan.building) : null), [plan]);
  if (!plan || !after) return null;
  const openingArea = (e: EnergySummary) => e.windowArea + e.doorArea;
  const change =
    before.heatingDemand > 0
      ? (after.heatingDemand - before.heatingDemand) / before.heatingDemand
      : 0;
  const words = (text: string) => {
    const key = PLACEMENT_WORDS[text];
    return key ? t(key) : text;
  };
  return (
    <CustomSection title={t("wallPhoto.changes")}>
      {count === 0 ? (
        <p className="text-sm text-muted">{t("wallPhoto.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {storeys.map((storey) => {
            const here = plan.changes.filter((c) => c.storeyId === storey.id);
            if (here.length === 0) return null;
            return (
              <li key={storey.id} className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">{storey.name}</span>
                <span className="text-xs text-muted">
                  {CHANGE_ORDER.map((change) => {
                    const n = here.filter((c) => c.change === change).length;
                    return n > 0 ? t(`wallPhoto.${change}`, { count: n }) : null;
                  })
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {here
                  .filter((c) => c.notes.length > 0)
                  .map((c) => (
                    <span key={c.opening.id} className="text-xs text-muted">
                      {t(c.opening.kind === "door" ? "wallPhoto.door" : "wallPhoto.window")}:{" "}
                      {c.notes.map(words).join(", ")}
                    </span>
                  ))}
              </li>
            );
          })}
          <li className="flex flex-col gap-0.5 border-t border-line pt-2">
            <span className="text-xs text-muted">
              {t("wallPhoto.openingArea", {
                before: formatNumber(openingArea(before), language, 1),
                after: formatNumber(openingArea(after), language, 1),
              })}
            </span>
            <span className="text-xs text-muted">
              {t("wallPhoto.demand", {
                before: formatNumber(before.heatingDemand, language, 0),
                after: formatNumber(after.heatingDemand, language, 0),
                change: `${change > 0 ? "+" : ""}${formatNumber(change * 100, language, 1)}`,
              })}
            </span>
          </li>
          {plan.dropped.length > 0 && (
            <li className="flex flex-col gap-0.5">
              <span className="font-medium text-mark">
                {t("wallPhoto.dropped", { count: plan.dropped.length })}
              </span>
              {plan.dropped.map((d) => (
                <span key={d.index} className="text-xs text-mark">
                  #{d.index + 1}: {words(d.reason)}
                </span>
              ))}
            </li>
          )}
        </ul>
      )}
    </CustomSection>
  );
}
