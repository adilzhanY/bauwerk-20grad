import { Presence } from "@/components/shared/Presence";
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Copy,
  DoorOpen,
  RulerDimensionLine,
  Trash2,
} from "lucide-react";
import {
  HeatPump,
  InteriorWall,
  Radiator,
  Roof,
  Storey as StoreyIcon,
  WallHatched,
  WindowFrame,
} from "@/components/shared/icons";
import { useT } from "@/i18n/useT";
import { formatArea, formatBaumass, formatMetres } from "@/lib/format";
import { distance, edges } from "@/geometry/polygon";
import type { Storey } from "@/geometry/types";
import { sameSelection, useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { LayerGroup, LayerRow, RowAction } from "./LayerRow";
import { FilePreview } from "./FilePreview";
import type { PreviewItem } from "./FilePreview";
import { planPreview } from "./fileLabel";

/**
 * Every element of the building as a tree, after Figma's layers: the roof, then the storeys
 * from the top, each with its rooms, walls, openings, interior walls, radiators and
 * measurements, with an eye on every storey. The survey panel shows it folded as "Elements".
 */
export function ElementTree() {
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
  const removeStorey = useEditorStore((s) => s.removeStorey);
  const moveStorey = useEditorStore((s) => s.moveStorey);
  const duplicateStorey = useEditorStore((s) => s.duplicateStorey);
  const heatPumps = building.heatPumps ?? [];
  const storeys = building.storeys;
  const activeIndex = storeys.findIndex((s) => s.id === activeStoreyId);
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
          icon={<Roof size={14} />}
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
              icon={<HeatPump size={14} />}
              label={t("tree.heatPump", { n: i + 1 })}
              selected={sameSelection(selection, target)}
              onSelect={() => {
                select(target);
              }}
            />
          );
        })}
      </ul>
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
        icon={<StoreyIcon size={14} />}
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
          <LayerGroup
            label={t("tree.rooms")}
            count={storey.rooms.length}
            holdsSelection={selection?.kind === "room" && selection.storeyId === storey.id}
          >
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
          <LayerGroup
            label={t("tree.walls")}
            count={walls.length}
            holdsSelection={selection?.kind === "wall" && selection.storeyId === storey.id}
          >
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
                  icon={<WallHatched size={13} />}
                  label={t("tree.wall", { n: edge.index + 1 })}
                  meta={formatMetres(distance(edge.a, edge.b), language)}
                  selected={isSelected(target)}
                  onSelect={pick(target)}
                />
              );
            })}
          </LayerGroup>
          <LayerGroup
            label={t("tree.openings")}
            count={storey.openings.length}
            holdsSelection={selection?.kind === "opening" && selection.storeyId === storey.id}
          >
            {storey.openings.map((opening) => {
              const door = opening.kind === "door";
              const n = door ? ++doors : ++windows;
              const target: Selection = { kind: "opening", storeyId: storey.id, id: opening.id };
              return (
                <LayerRow
                  key={opening.id}
                  level={3}
                  icon={door ? <DoorOpen size={13} /> : <WindowFrame size={13} />}
                  label={t(door ? "tree.door" : "tree.window", { n })}
                  meta={`${formatMetres(opening.width, language)} × ${formatMetres(opening.height, language)}`}
                  selected={isSelected(target)}
                  onSelect={pick(target)}
                />
              );
            })}
          </LayerGroup>
          {storey.interiorWalls.length > 0 && (
            <LayerGroup
              label={t("tree.interiorWalls")}
              count={storey.interiorWalls.length}
              holdsSelection={
                selection?.kind === "interiorWall" && selection.storeyId === storey.id
              }
            >
              {storey.interiorWalls.map((segment, i) => {
                const target: Selection = { kind: "interiorWall", storeyId: storey.id, index: i };
                return (
                  <LayerRow
                    key={i}
                    level={3}
                    icon={<InteriorWall size={13} />}
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
            <LayerGroup
              label={t("tree.radiators")}
              count={radiators.length}
              holdsSelection={selection?.kind === "radiator" && selection.storeyId === storey.id}
            >
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
                    icon={<Radiator size={13} />}
                    label={t("tree.radiator", { n: i + 1 })}
                    selected={isSelected(target)}
                    onSelect={pick(target)}
                  />
                );
              })}
            </LayerGroup>
          )}
          {measurements.length > 0 && (
            <LayerGroup
              label={t("tree.measurements")}
              count={measurements.length}
              holdsSelection={selection?.kind === "measurement" && selection.storeyId === storey.id}
            >
              {measurements.map((m, i) => {
                const target: Selection = { kind: "measurement", storeyId: storey.id, id: m.id };
                return (
                  <LayerRow
                    key={m.id}
                    level={3}
                    icon={<RulerDimensionLine size={13} />}
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
