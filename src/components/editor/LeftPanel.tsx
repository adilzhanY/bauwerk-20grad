import { Presence } from "@/components/shared/Presence";
import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Building2,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  Flame,
  Layers,
  Plus,
  Ruler,
  Settings2,
  SquareDashedBottom,
  Thermometer,
  Trash2,
  Triangle,
} from "lucide-react";
import { CustomTabPanel, CustomTabs } from "@/components/shared/CustomTabs";
import { useT } from "@/i18n/useT";
import { formatArea, formatBaumass, formatMetres } from "@/lib/format";
import { distance, edges } from "@/geometry/polygon";
import type { Storey } from "@/geometry/types";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import type { SyncStatus } from "@/sync/client";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomSection } from "@/components/shared/CustomField";
import { cx } from "@/components/shared/cx";
import { LayerGroup, LayerRow, RowAction } from "@/components/editor/LayerRow";
import { FilePreview } from "@/components/editor/FilePreview";
import type { PreviewItem } from "@/components/editor/FilePreview";
import { MediaLayers } from "@/components/editor/MediaLayers";
import { planPreview } from "@/components/editor/fileLabel";
import { NewBuildingDialog } from "@/components/editor/NewBuildingDialog";
import { ProjectSwitcher } from "@/components/editor/ProjectSwitcher";
import { SettingsSection } from "@/components/editor/SettingsSection";
import { devMode } from "@/lib/devMode";
import { toolHint } from "@/components/editor/tools";
import { UnderlaySection } from "@/components/editor/UnderlaySection";

type SectionId = "layers" | "underlay" | "settings";

/**
 * The layers panel at the left of the editor, after Figma's: the project on top, then tabs.
 * "Layers" is the building as a tree (roof, storeys, and in each storey its rooms, walls,
 * openings, interior walls and radiators) with an eye on every storey and on the scene
 * layers below it. The other tabs are the zones, the location, the floor plan underlay and
 * the settings. The hint for the current tool sits at the bottom.
 */
export function LeftPanel({ syncStatus }: { syncStatus: SyncStatus | "local" }) {
  const t = useT();
  const tabsId = useId();
  const tool = useEditorStore((s) => s.tool);
  const [section, setSection] = useState<SectionId>("layers");
  return (
    <aside
      aria-label={t("a11y.leftPanel")}
      className="pointer-events-auto flex h-full min-h-0 flex-col border-r border-line bg-paper"
    >
      <ProjectSwitcher status={syncStatus} />
      <CustomTabs
        id={tabsId}
        label={t("panel.view")}
        value={section}
        tabs={[
          { value: "layers", label: t("tree.title") },
          { value: "underlay", label: t("underlay.short") },
          {
            value: "settings",
            label: t("panel.settings"),
            icon: <Settings2 size={16} aria-hidden />,
            iconOnly: true,
          },
        ]}
        onChange={setSection}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CustomTabPanel id={tabsId} value={section}>
          {section === "layers" && <LayerTree />}
          {section === "underlay" && <UnderlaySection />}
          {section === "settings" && <SettingsSection examples={devMode()} />}
        </CustomTabPanel>
      </div>
      <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted">
        {t(toolHint[tool])}
      </p>
    </aside>
  );
}

function LayerTree() {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const selection = useEditorStore((s) => s.selection);
  const activeStoreyId = useEditorStore((s) => s.activeStoreyId);
  const language = useEditorStore((s) => s.language);
  const otherStoreys = useEditorStore((s) => s.otherStoreys);
  const hiddenStoreys = useEditorStore((s) => s.hiddenStoreys);
  const select = useEditorStore((s) => s.select);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const setOtherStoreys = useEditorStore((s) => s.setOtherStoreys);
  const toggleStoreyHidden = useEditorStore((s) => s.toggleStoreyHidden);
  const addStorey = useEditorStore((s) => s.addStorey);
  const removeStorey = useEditorStore((s) => s.removeStorey);
  const moveStorey = useEditorStore((s) => s.moveStorey);
  const duplicateStorey = useEditorStore((s) => s.duplicateStorey);
  const heatPumps = building.heatPumps ?? [];
  const storeys = building.storeys;
  const activeIndex = storeys.findIndex((s) => s.id === activeStoreyId);
  const [newBuilding, setNewBuilding] = useState(false);
  // Storeys the user opened or closed by hand; the active one is open unless closed.
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => openState[id] ?? id === activeStoreyId;
  const toggleOpen = (id: string) => {
    setOpenState({ ...openState, [id]: !isOpen(id) });
  };
  const roofHidden = otherStoreys.roof === "hidden";
  const [preview, setPreview] = useState<PreviewItem | null>(null);

  const onStoreyKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (activeIndex === -1) return;
    // Up raises the storey index, matching the top storey being drawn first.
    const step = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = storeys[(activeIndex + step + storeys.length) % storeys.length];
    if (next) {
      setActiveStorey(next.id);
      select({ kind: "storey", id: next.id });
    }
  };

  return (
    <>
      <CustomSection
        title={t("tree.title")}
        first
        action={
          <span className="flex items-center gap-0.5">
            <CustomIconButton
              label={t("newBuilding.title")}
              size="sm"
              onClick={() => {
                setNewBuilding(true);
              }}
            >
              <Box size={15} />
            </CustomIconButton>
            <CustomIconButton label={t("storey.add")} size="sm" onClick={addStorey}>
              <Plus size={15} />
            </CustomIconButton>
          </span>
        }
      >
        <Presence show={newBuilding} kind="float">
          <NewBuildingDialog
            onClose={() => {
              setNewBuilding(false);
            }}
          />
        </Presence>
        <ul role="tree" aria-label={t("tree.title")} className="-mx-2 flex flex-col">
          <LayerRow
            level={0}
            icon={<Building2 size={15} />}
            label={building.name}
            selected={selection === null}
            onSelect={clearSelection}
          />
          <LayerRow
            level={1}
            icon={<Triangle size={14} />}
            label={t("tree.roof")}
            selected={selection?.kind === "roof"}
            onSelect={() => {
              select({ kind: "roof" });
            }}
            hidden={roofHidden}
            onToggleHidden={() => {
              setOtherStoreys({ roof: roofHidden ? "outline" : "hidden" });
            }}
          />
          <MediaLayers onPreview={setPreview} />
          {storeys.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">{t("empty.body")}</li>
          )}
          {[...storeys].reverse().map((storey) => {
            const index = storeys.indexOf(storey);
            const active = storey.id === activeStoreyId;
            return (
              <StoreyLayer
                key={storey.id}
                storey={storey}
                active={active}
                open={isOpen(storey.id)}
                hidden={hiddenStoreys.includes(storey.id)}
                selection={selection}
                meta={formatMetres(storey.height, language)}
                onToggleOpen={() => {
                  toggleOpen(storey.id);
                }}
                onSelect={() => {
                  setActiveStorey(storey.id);
                  select({ kind: "storey", id: storey.id });
                }}
                onKeyDown={onStoreyKey}
                onToggleHidden={() => {
                  toggleStoreyHidden(storey.id);
                }}
                onPreview={setPreview}
                actions={
                  <>
                    <RowAction
                      label={t("storey.moveDown")}
                      disabled={index === 0}
                      onClick={() => {
                        moveStorey(storey.id, -1);
                      }}
                    >
                      <ArrowDown size={13} />
                    </RowAction>
                    <RowAction
                      label={t("storey.moveUp")}
                      disabled={index === storeys.length - 1}
                      onClick={() => {
                        moveStorey(storey.id, 1);
                      }}
                    >
                      <ArrowUp size={13} />
                    </RowAction>
                    <RowAction
                      label={t("storey.duplicate")}
                      onClick={() => {
                        duplicateStorey(storey.id);
                      }}
                    >
                      <Copy size={13} />
                    </RowAction>
                    <RowAction
                      label={t("storey.remove")}
                      onClick={() => {
                        removeStorey(storey.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </RowAction>
                  </>
                }
              />
            );
          })}
          {heatPumps.map((pump, i) => {
            const target: Selection = { kind: "heatPump", id: pump.id };
            return (
              <LayerRow
                key={pump.id}
                level={1}
                icon={<Flame size={14} />}
                label={t("tree.heatPump", { n: i + 1 })}
                selected={sameSelection(selection, target)}
                onSelect={() => {
                  select(target);
                }}
              />
            );
          })}
        </ul>
      </CustomSection>
      <SceneLayers />
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
    </>
  );
}

function StoreyLayer({
  storey,
  active,
  open,
  hidden,
  selection,
  meta,
  onToggleOpen,
  onSelect,
  onKeyDown,
  onToggleHidden,
  onPreview,
  actions,
}: {
  storey: Storey;
  active: boolean;
  open: boolean;
  hidden: boolean;
  selection: Selection | null;
  meta: string;
  onToggleOpen: () => void;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onToggleHidden: () => void;
  onPreview: (item: PreviewItem) => void;
  actions: ReactNode;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const plan = useEditorStore((s) => s.floorPlanImages[storey.id]);
  const footprint = useEditorStore((s) => s.building.footprint);
  const zones = useEditorStore((s) => s.building.zones);
  const select = useEditorStore((s) => s.select);
  const setActiveStorey = useEditorStore((s) => s.setActiveStorey);
  const walls = edges(footprint);
  const radiators = storey.radiators ?? [];
  const measurements = storey.measurements ?? [];
  const pick = (target: Selection) => () => {
    setActiveStorey(storey.id);
    select(target);
  };
  const isSelected = (target: Selection) => sameSelection(selection, target);
  let windows = 0;
  let doors = 0;

  return (
    <>
      <LayerRow
        level={1}
        icon={<Layers size={14} />}
        label={storey.name}
        meta={meta}
        strong={active}
        current={active}
        selected={selection?.kind === "storey" && selection.id === storey.id}
        open={open}
        onToggleOpen={onToggleOpen}
        onSelect={onSelect}
        onKeyDown={onKeyDown}
        hidden={hidden}
        onToggleHidden={onToggleHidden}
        actions={actions}
      />
      <Presence show={open} kind="float">
        <>
          {plan && (
            <LayerRow
              level={2}
              icon={
                <img
                  src={plan.url}
                  alt=""
                  draggable={false}
                  className="h-4 w-4 rounded-sm object-cover"
                />
              }
              label={t("tree.floorPlan")}
              onSelect={() => {
                onPreview(planPreview(plan.url, storey.name, t("tree.floorPlan")));
              }}
            />
          )}
          <LayerGroup label={t("tree.rooms")} count={storey.rooms.length}>
            {storey.rooms.map((room) => {
              const zone = zones.find((z) => z.id === room.zoneId);
              const target: Selection = { kind: "room", storeyId: storey.id, id: room.id };
              return (
                <LayerRow
                  key={room.id}
                  level={3}
                  icon={
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full border border-line-strong"
                      style={{ background: zone?.color ?? "transparent" }}
                    />
                  }
                  label={room.name}
                  meta={formatArea(room.area, language)}
                  selected={isSelected(target)}
                  onSelect={pick(target)}
                />
              );
            })}
          </LayerGroup>
          <LayerGroup label={t("tree.walls")} count={walls.length}>
            {walls.map((edge) => {
              const target: Selection = {
                kind: "wall",
                storeyId: storey.id,
                wallIndex: edge.index,
              };
              return (
                <LayerRow
                  key={edge.index}
                  level={3}
                  icon={<SquareDashedBottom size={13} />}
                  label={t("tree.wall", { n: edge.index + 1 })}
                  meta={formatMetres(distance(edge.a, edge.b), language)}
                  selected={isSelected(target)}
                  onSelect={pick(target)}
                />
              );
            })}
          </LayerGroup>
          <LayerGroup label={t("tree.openings")} count={storey.openings.length}>
            {storey.openings.map((opening) => {
              const door = opening.kind === "door";
              const n = door ? ++doors : ++windows;
              const target: Selection = { kind: "opening", storeyId: storey.id, id: opening.id };
              return (
                <LayerRow
                  key={opening.id}
                  level={3}
                  icon={door ? <DoorOpen size={13} /> : <SquareDashedBottom size={13} />}
                  label={t(door ? "tree.door" : "tree.window", { n })}
                  meta={`${formatMetres(opening.width, language)} × ${formatMetres(opening.height, language)}`}
                  selected={isSelected(target)}
                  onSelect={pick(target)}
                />
              );
            })}
          </LayerGroup>
          {storey.interiorWalls.length > 0 && (
            <LayerGroup label={t("tree.interiorWalls")} count={storey.interiorWalls.length}>
              {storey.interiorWalls.map((segment, i) => {
                const target: Selection = { kind: "interiorWall", storeyId: storey.id, index: i };
                return (
                  <LayerRow
                    key={i}
                    level={3}
                    icon={<SquareDashedBottom size={13} />}
                    label={t("tree.interiorWall", { n: i + 1 })}
                    meta={formatMetres(distance(segment.a, segment.b), language)}
                    selected={isSelected(target)}
                    onSelect={pick(target)}
                  />
                );
              })}
            </LayerGroup>
          )}
          {radiators.length > 0 && (
            <LayerGroup label={t("tree.radiators")} count={radiators.length}>
              {radiators.map((radiator, i) => {
                const target: Selection = {
                  kind: "radiator",
                  storeyId: storey.id,
                  id: radiator.id,
                };
                return (
                  <LayerRow
                    key={radiator.id}
                    level={3}
                    icon={<Thermometer size={13} />}
                    label={t("tree.radiator", { n: i + 1 })}
                    selected={isSelected(target)}
                    onSelect={pick(target)}
                  />
                );
              })}
            </LayerGroup>
          )}
          {measurements.length > 0 && (
            <LayerGroup label={t("tree.measurements")} count={measurements.length}>
              {measurements.map((m, i) => {
                const target: Selection = { kind: "measurement", storeyId: storey.id, id: m.id };
                return (
                  <LayerRow
                    key={m.id}
                    level={3}
                    icon={<Ruler size={13} />}
                    label={t("tree.measurement", { n: i + 1 })}
                    meta={formatBaumass(distance(m.a, m.b), language)}
                    selected={isSelected(target)}
                    onSelect={pick(target)}
                  />
                );
              })}
            </LayerGroup>
          )}
        </>
      </Presence>
    </>
  );
}

/** The layers of the scene around the building, each with its eye. */
function SceneLayers() {
  const t = useT();
  const showGrid = useEditorStore((s) => s.showGrid);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const showMap = useEditorStore((s) => s.showMap);
  const setShowMap = useEditorStore((s) => s.setShowMap);
  const hasOrigin = useEditorStore((s) => s.building.origin !== undefined);
  const bridges = useEditorStore((s) => s.showBridges);
  const setBridges = useEditorStore((s) => s.setShowBridges);
  const photos = useEditorStore((s) => s.showFacadePhotos);
  const setPhotos = useEditorStore((s) => s.setShowFacadePhotos);
  const hasPhotos = useEditorStore((s) => Object.keys(s.facadePhotos).length > 0);
  const rows: { label: string; on: boolean; set: (on: boolean) => void; disabled?: string }[] = [
    { label: t("tree.grid"), on: showGrid, set: setShowGrid },
    {
      label: t("tree.map"),
      on: showMap && hasOrigin,
      set: setShowMap,
      disabled: hasOrigin ? undefined : t("settings.mapNeedsLocation"),
    },
    { label: t("tree.bridges"), on: bridges, set: setBridges },
    {
      label: t("tree.facadePhotos"),
      on: photos && hasPhotos,
      set: setPhotos,
      disabled: hasPhotos ? undefined : t("tree.facadePhotosNone"),
    },
  ];
  return (
    <CustomSection title={t("tree.scene")}>
      <ul className="-mx-2 flex flex-col">
        {rows.map((row) => (
          <li
            key={row.label}
            title={row.disabled}
            className="group flex h-8 items-center gap-2 rounded-soft pr-1 pl-3 hover:bg-panel"
          >
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-sm",
                row.on ? "text-ink" : "text-muted",
                row.disabled && "opacity-45",
              )}
            >
              {row.label}
            </span>
            <RowAction
              label={row.on ? t("tree.hide") : t("tree.show")}
              disabled={row.disabled !== undefined}
              onClick={() => {
                row.set(!row.on);
              }}
            >
              {row.on ? <Eye size={13} /> : <EyeOff size={13} />}
            </RowAction>
          </li>
        ))}
      </ul>
    </CustomSection>
  );
}
