import { useRef, useState } from "react";
import { ChevronDown, ChevronsRight, Eye } from "lucide-react";
import { Card } from "@/components/shared/Card";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Hint } from "@/components/shared/Hint";
import { Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { SectionLabel } from "@/components/shared/PageTitle";
import { cx } from "@/components/shared/cx";
import { useDismiss } from "@/components/shared/useDismiss";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomField, CustomFieldGroup } from "@/components/shared/CustomField";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSlider } from "@/components/shared/CustomSlider";
import { formatNumber } from "@/lib/format";
import { useShallow } from "zustand/react/shallow";
import type { CameraView } from "@/store/building";

/** The views after 3D and the plan: the four elevations, each facing that compass side. */
const ELEVATIONS: { view: CameraView; letter: MessageKey; label: MessageKey }[] = [
  { view: "n", letter: "view.n", label: "view.nLabel" },
  { view: "e", letter: "view.e", label: "view.eLabel" },
  { view: "s", letter: "view.s", label: "view.sLabel" },
  { view: "w", letter: "view.w", label: "view.wLabel" },
];

/**
 * The view switch under the tool bar: the 3D view and the floor plan first (the plan is where
 * walls are traced), then the four elevations, then the View menu with what the scene shows,
 * and a button that hides or shows the side panels.
 */
export function ViewPill({
  panelsOpen,
  onTogglePanels,
}: {
  panelsOpen: boolean;
  onTogglePanels: () => void;
}) {
  const t = useT();
  const planView = useEditorStore((s) => s.planView);
  const cameraView = useEditorStore((s) => s.cameraView.view);
  const setCameraView = useEditorStore((s) => s.setCameraView);
  const setPlanView = useEditorStore((s) => s.setPlanView);

  const views: { id: string; letter: string; label: string; active: boolean; pick: () => void }[] =
    [
      {
        id: "3d",
        letter: t("view.3d"),
        label: t("view.3dLabel"),
        active: !planView && cameraView === "3d",
        pick: () => {
          setCameraView("3d");
        },
      },
      {
        id: "plan",
        letter: t("view.planShort"),
        label: t("view.plan"),
        active: planView,
        pick: () => {
          setPlanView(true);
        },
      },
      ...ELEVATIONS.map(({ view, letter, label }) => ({
        id: view,
        letter: t(letter),
        label: t(label),
        active: !planView && cameraView === view,
        pick: () => {
          setCameraView(view);
        },
      })),
    ];

  return (
    <Card elevation="float" className="pointer-events-auto flex h-11 items-center gap-0.5 p-1">
      <div
        role="radiogroup"
        aria-label={t("editor.projection")}
        className="flex items-center gap-0.5"
      >
        {views.map((v, i) => (
          <span key={v.id} className="flex items-center gap-0.5">
            {/* 3D and the plan, then the elevations. */}
            {i === 2 && <span aria-hidden className="mx-1 h-5 w-px bg-line" />}
            <button
              type="button"
              role="radio"
              aria-checked={v.active}
              aria-label={v.label}
              title={v.label}
              onClick={v.pick}
              className={cx(
                "flex h-9 min-w-9 items-center justify-center rounded-control px-2.5 text-sm transition-colors",
                v.active
                  ? "bg-select font-semibold text-white"
                  : "font-medium text-muted hover:bg-panel hover:text-ink",
              )}
            >
              {v.letter}
            </button>
          </span>
        ))}
      </div>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <ViewMenu />
      <CustomIconButton
        label={panelsOpen ? t("editor.hidePanels") : t("editor.showPanels")}
        onClick={onTogglePanels}
      >
        <ChevronsRight
          size={16}
          aria-hidden
          className={cx("transition-transform", !panelsOpen && "rotate-180")}
        />
      </CustomIconButton>
    </Card>
  );
}

/** What the scene shows, in one place: ground, photos, thermal bridges, the other storeys. */
function ViewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => {
    setOpen(false);
  });
  const showGrid = useEditorStore((s) => s.showGrid);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const showMap = useEditorStore((s) => s.showMap);
  const setShowMap = useEditorStore((s) => s.setShowMap);
  const hasOrigin = useEditorStore((s) => s.building.origin !== undefined);
  const photos = useEditorStore((s) => s.showFacadePhotos);
  const setPhotos = useEditorStore((s) => s.setShowFacadePhotos);
  const hasPhotos = useEditorStore((s) => Object.keys(s.facadePhotos).length > 0);
  const bridges = useEditorStore((s) => s.showBridges);
  const setBridges = useEditorStore((s) => s.setShowBridges);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const setOtherStoreys = useEditorStore((s) => s.setOtherStoreys);
  const whole = otherStoreys.below === "solid" && otherStoreys.above === "ghost";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className={cx(
          "flex h-9 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium transition-colors",
          open ? "bg-select-soft text-select" : "text-muted hover:bg-panel hover:text-ink",
        )}
      >
        <Eye size={16} aria-hidden />
        {t("view.menu")}
        <ChevronDown size={14} aria-hidden />
      </button>
      <Presence show={open} kind="float">
        <Popover
          role="dialog"
          aria-label={t("view.menu")}
          className="absolute top-11 right-0 flex max-h-[70vh] w-[22rem] flex-col gap-3 overflow-y-auto"
        >
          <CustomCheckbox
            variant="switch"
            label={t("settings.grid")}
            checked={showGrid}
            onChange={setShowGrid}
          />
          <CustomCheckbox
            variant="switch"
            label={t("settings.mapGround")}
            checked={showMap && hasOrigin}
            disabled={!hasOrigin}
            onChange={setShowMap}
          />
          <Presence show={!hasOrigin}>
            <Hint className="-mt-1.5">{t("settings.mapNeedsLocation")}</Hint>
          </Presence>
          <CustomCheckbox
            variant="switch"
            label={t("tree.facadePhotos")}
            checked={photos && hasPhotos}
            disabled={!hasPhotos}
            onChange={setPhotos}
          />
          <CustomCheckbox
            variant="switch"
            label={t("bridges.show")}
            checked={bridges}
            onChange={setBridges}
          />
          <CustomCheckbox
            variant="switch"
            label={t("editor.wholeBuilding")}
            checked={whole}
            onChange={(on) => {
              setOtherStoreys(
                on
                  ? { above: "ghost", below: "solid", roof: "solid" }
                  : { above: "outline", below: "ghost", roof: "outline" },
              );
            }}
          />
          <SectionLabel className="mt-1 border-t border-line pt-3">
            {t("panel.otherStoreys")}
          </SectionLabel>
          <OtherStoreysControls />
        </Popover>
      </Presence>
    </div>
  );
}

/** How the storeys that are not being edited are drawn: above, below, the roof. */
function OtherStoreysControls() {
  const t = useT();
  const { o, language, setOtherStoreys } = useEditorStore(
    useShallow((s) => ({
      o: s.otherStoreys,
      language: s.language,
      setOtherStoreys: s.setOtherStoreys,
    })),
  );
  const showOpacity = o.above === "ghost" || o.below === "ghost" || o.roof === "ghost";
  return (
    <div className="flex flex-col gap-3">
      <CustomFieldGroup label={t("view.storeysAbove")}>
        <CustomSegmented
          label={t("view.storeysAbove")}
          value={o.above}
          options={[
            { value: "hidden", label: t("view.storeysHidden") },
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
          ]}
          onChange={(above) => {
            setOtherStoreys({ above });
          }}
        />
      </CustomFieldGroup>
      <CustomFieldGroup label={t("view.storeysBelow")}>
        <CustomSegmented
          label={t("view.storeysBelow")}
          value={o.below}
          options={[
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
            { value: "solid", label: t("view.storeysSolid") },
          ]}
          onChange={(below) => {
            setOtherStoreys({ below });
          }}
        />
      </CustomFieldGroup>
      <CustomFieldGroup label={t("view.roofDisplay")}>
        <CustomSegmented
          label={t("view.roofDisplay")}
          value={o.roof}
          options={[
            { value: "hidden", label: t("view.storeysHidden") },
            { value: "outline", label: t("view.storeysOutline") },
            { value: "ghost", label: t("view.storeysGhost") },
            { value: "solid", label: t("view.storeysSolid") },
          ]}
          onChange={(roof) => {
            setOtherStoreys({ roof });
          }}
        />
      </CustomFieldGroup>
      <Presence show={showOpacity}>
        <CustomField
          label={`${t("view.ghostOpacity")}: ${formatNumber(Math.round(o.ghostOpacity * 100), language)} %`}
        >
          <CustomSlider
            label={t("view.ghostOpacity")}
            value={Math.round(o.ghostOpacity * 100)}
            min={5}
            max={60}
            step={5}
            onChange={(pct) => {
              setOtherStoreys({ ghostOpacity: pct / 100 });
            }}
            format={(pct) => `${formatNumber(pct, language)} %`}
          />
        </CustomField>
      </Presence>
    </div>
  );
}
