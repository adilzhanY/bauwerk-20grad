import { useEffect, useState } from "react";
import { ArrowRight, Camera, HousePlus, ImagePlus, Rows3 } from "lucide-react";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomSection } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";
import { Spinner } from "@/components/shared/Spinner";
import { FloorPlan, Roof, Storey as StoreyIcon } from "@/components/shared/icons";
import { useRouter } from "@/app/router";
import { orientationOf } from "@/geometry/energy";
import { edges } from "@/geometry/polygon";
import { roofOf } from "@/geometry/roof";
import type { Storey } from "@/geometry/types";
import { isDefaultRoomName } from "@/i18n";
import { useT } from "@/i18n/useT";
import { devMode } from "@/lib/devMode";
import { formatMetres, formatNumber } from "@/lib/format";
import { useFloorplanAvailable } from "@/lod2/api/floorplan";
import { can } from "@/projects/roles";
import { useEditorStore } from "@/store/building";
import { ElementTree } from "./ElementTree";
import { FilePreview } from "./FilePreview";
import type { PreviewItem } from "./FilePreview";
import { FilesSection } from "./FilesSection";
import { FloorPlanSection } from "./FloorPlanSection";
import { NewBuildingDialog } from "./NewBuildingDialog";
import { SettingsSection } from "./SettingsSection";
import { SurveyRow, Thumb } from "./SurveyRow";
import { UnderlaySection } from "./UnderlaySection";
import { planPreview } from "./fileLabel";

/** One empty list, so the store selectors return the same value every time. */
const NONE: never[] = [];

/**
 * The survey panel at the left of the editor: what a survey goes through, as a checklist that
 * shows what is done. Per storey its height, its floor plan (or "Add plan", which reads one)
 * and its rooms; per outside wall its facade photo (or "Add photo"); the roof; the project's
 * files. Every element of the model sits below in "Elements", folded. At the foot, the way on
 * to the variants and the energy balance.
 */
export function LeftPanel() {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [newBuilding, setNewBuilding] = useState(false);
  return (
    <aside
      aria-label={t("a11y.leftPanel")}
      className="pointer-events-auto flex h-full min-h-0 flex-col border-r border-line bg-paper"
    >
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <StoreysSurvey onPreview={setPreview} />
        <EnvelopeSurvey onPreview={setPreview} />
        <FilesSection onPreview={setPreview} />
        <CustomSection
          title={t("survey.elements")}
          collapsible
          action={
            <CustomIconButton
              label={t("newBuilding.title")}
              size="sm"
              onClick={() => {
                setNewBuilding(true);
              }}
            >
              <HousePlus size={15} />
            </CustomIconButton>
          }
        >
          <ElementTree />
        </CustomSection>
        {devMode() && <SettingsSection />}
      </div>
      <footer className="border-t border-line p-3">
        <CustomButton
          className="w-full"
          icon={<ArrowRight size={15} aria-hidden />}
          onClick={() => {
            navigate({ page: "variants" });
          }}
        >
          {t("survey.toVariants")}
        </CustomButton>
      </footer>
      <Presence show={newBuilding} kind="float">
        <NewBuildingDialog
          onClose={() => {
            setNewBuilding(false);
          }}
        />
      </Presence>
      <Presence value={preview} kind="float">
        {(item) => (
          <FilePreview
            item={item}
            onClose={() => {
              setPreview(null);
            }}
          />
        )}
      </Presence>
    </aside>
  );
}

/** The storeys from the top: height, floor plan, rooms. */
function StoreysSurvey({ onPreview }: { onPreview: (item: PreviewItem) => void }) {
  const t = useT();
  const storeys = useEditorStore((s) => s.building.storeys);
  const [planFor, setPlanFor] = useState<Storey | null>(null);
  return (
    <CustomSection title={t("survey.storeys")} first>
      <Presence show={storeys.length === 0}>
        <Hint>{t("empty.body")}</Hint>
      </Presence>
      {[...storeys].reverse().map((storey) => (
        <StoreyBlock
          key={storey.id}
          storey={storey}
          onPreview={onPreview}
          onAddPlan={() => {
            setPlanFor(storey);
          }}
        />
      ))}
      <Presence value={planFor} kind="float">
        {(storey) => (
          <FloorPlanDialog
            storey={storey}
            onClose={() => {
              setPlanFor(null);
            }}
          />
        )}
      </Presence>
    </CustomSection>
  );
}

function StoreyBlock({
  storey,
  onPreview,
  onAddPlan,
}: {
  storey: Storey;
  onPreview: (item: PreviewItem) => void;
  onAddPlan: () => void;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const active = useEditorStore((s) => s.activeStoreyId === storey.id);
  const plan = useEditorStore((s) => s.floorPlanImages[storey.id]);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const select = useEditorStore((s) => s.select);
  const role = useEditorStore((s) => s.projectRole);
  const editor = role === null || can(role, "edit");
  const named = storey.rooms.filter((r) => !isDefaultRoomName(r.name)).length;
  return (
    <ul aria-label={storey.name} className="-mx-2 flex flex-col">
      <SurveyRow
        icon={<StoreyIcon size={16} />}
        label={storey.name}
        meta={formatMetres(storey.height, language)}
        strong
        selected={active}
        onSelect={() => {
          setActiveStorey(storey.id);
          select({ kind: "storey", id: storey.id });
        }}
      />
      <SurveyRow
        indent
        icon={plan ? <Thumb url={plan.url} /> : <FloorPlan size={16} />}
        label={t("tree.floorPlan")}
        meta={plan ? undefined : t("survey.missing")}
        muted={!plan}
        onSelect={() => {
          if (plan) onPreview(planPreview(plan.url, storey.name, t("tree.floorPlan")));
          else if (editor) onAddPlan();
        }}
        action={
          editor && (
            <CustomIconButton
              label={
                plan
                  ? t("survey.replacePlan", { storey: storey.name })
                  : t("survey.addPlan", { storey: storey.name })
              }
              size="xs"
              onClick={onAddPlan}
            >
              <ImagePlus size={13} />
            </CustomIconButton>
          )
        }
      />
      <SurveyRow
        indent
        icon={<Rows3 size={16} />}
        label={t("survey.rooms", { n: storey.rooms.length })}
        meta={t("survey.named", { n: named })}
        muted
        onSelect={() => {
          setActiveStorey(storey.id);
        }}
      />
    </ul>
  );
}

/**
 * "Add plan" for one storey: the AI reads the drawing onto the storey (FloorPlanSection), and
 * below it, folded, a drawing laid under the model to trace by hand.
 */
function FloorPlanDialog({ storey, onClose }: { storey: Storey; onClose: () => void }) {
  const t = useT();
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const available = useFloorplanAvailable();
  // The reading works on the active storey.
  useEffect(() => {
    setActiveStorey(storey.id);
  }, [setActiveStorey, storey.id]);
  return (
    <CustomDialog
      title={t("survey.planTitle", { storey: storey.name })}
      closeLabel={t("shortcuts.close")}
      onClose={onClose}
      width={560}
    >
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
        <Presence show={available === null}>
          <Spinner />
        </Presence>
        <Presence show={available === false}>
          <Hint>{t("survey.planServiceDown")}</Hint>
        </Presence>
        <FloorPlanSection onApplied={onClose} />
        <div className="-mx-4">
          <UnderlaySection collapsible />
        </div>
      </div>
    </CustomDialog>
  );
}

/** One row per outside wall with its facade photo, then the roof. */
function EnvelopeSurvey({ onPreview }: { onPreview: (item: PreviewItem) => void }) {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const shared = useEditorStore((s) => s.building.sharedEdges ?? NONE);
  const photos = useEditorStore((s) => s.facadePhotos);
  const language = useEditorStore((s) => s.language);
  const roofSelected = useEditorStore((s) => s.selection?.kind === "roof");
  const openPhoto = useEditorStore((s) => s.setPhotoWall);
  const highlight = useEditorStore((s) => s.setHighlightedWall);
  const select = useEditorStore((s) => s.select);
  const role = useEditorStore((s) => s.projectRole);
  const editor = role === null || can(role, "edit");

  // A row that goes away while hovered leaves no wall lit.
  useEffect(
    () => () => {
      highlight(null);
    },
    [highlight],
  );

  const walls = edges(building.footprint);
  const rotation = building.origin?.rotation ?? 0;
  const roof = roofOf(building);
  const windowsOn = (wall: number) =>
    building.storeys.reduce(
      (n, s) =>
        n +
        s.openings.filter((o) => !o.interior && o.wallIndex === wall && o.kind === "window").length,
      0,
    );

  return (
    <CustomSection title={t("survey.envelope")}>
      <ul aria-label={t("survey.envelope")} className="-mx-2 flex flex-col">
        {walls.map((wall) => {
          const n = wall.index + 1;
          const photo = photos[wall.index];
          const isShared = shared.includes(wall.index);
          const side = t(`survey.side.${orientationOf(wall.normal, rotation)}`);
          return (
            <SurveyRow
              key={wall.index}
              icon={photo ? <Thumb url={photo.url} /> : <Camera size={16} />}
              label={t("survey.facade", { n, side })}
              meta={
                isShared
                  ? t("tree.sharedWall")
                  : photo
                    ? t("survey.windows", { n: windowsOn(wall.index) })
                    : t("tree.noPhoto")
              }
              muted={!photo}
              onHover={(on) => {
                highlight(on ? wall.index : null);
              }}
              onSelect={() => {
                if (photo) {
                  onPreview({
                    kind: "url",
                    title: t("files.slot.facade", { n }),
                    url: photo.url,
                    mime: "image/jpeg",
                    fileName: `wall-${String(n)}.jpg`,
                  });
                } else if (editor && !isShared) openPhoto(wall.index);
                else {
                  const storeyId = building.storeys[0]?.id;
                  if (storeyId) select({ kind: "wall", storeyId, wallIndex: wall.index });
                }
              }}
              action={
                editor &&
                !isShared && (
                  <CustomIconButton
                    label={photo ? t("tree.replacePhoto", { n }) : t("tree.addPhoto", { n })}
                    size="xs"
                    onClick={() => {
                      openPhoto(wall.index);
                    }}
                  >
                    <Camera size={13} />
                  </CustomIconButton>
                )
              }
            />
          );
        })}
        <SurveyRow
          icon={<Roof size={16} />}
          label={t("tree.roof")}
          meta={
            roof.kind === "flat"
              ? t("roof.flat")
              : `${t(`roof.${roof.kind}`)}, ${formatNumber(roof.pitch, language, 0)}°`
          }
          selected={roofSelected}
          onSelect={() => {
            select({ kind: "roof" });
          }}
        />
      </ul>
    </CustomSection>
  );
}
