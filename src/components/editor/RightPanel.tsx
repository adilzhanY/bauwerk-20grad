import { SectionLabel } from "@/components/shared/PageTitle";
import { CustomFieldGroup } from "@/components/shared/CustomField";
import type { NoteTarget } from "@/geometry/types";
import { ThreadsSection } from "@/components/editor/ThreadsSection";
import { Presence } from "@/components/shared/Presence";
import { Notice } from "@/components/shared/Notice";
import { Hint } from "@/components/shared/Hint";
import { useMemo } from "react";
import { currentProjectRef, removePhoto } from "@/projects/projects";
import { Camera, Trash2 } from "lucide-react";
import { openingsOn, validateOpening } from "@/geometry/openings";
import type { OpeningError } from "@/geometry/openings";
import { area, distance, edges } from "@/geometry/polygon";
import type { Opening, Radiator, Room, Storey, Zone } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { BOX_LIMITS, rectangleOf } from "@/geometry/box";
import type { MessageKey } from "@/i18n";
import { formatArea, formatMetres, formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import type { Selection } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomSlider } from "@/components/shared/CustomSlider";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomReadOnly, CustomSection } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { CustomSwatches } from "@/components/shared/CustomSwatches";
import { CustomTextInput } from "@/components/shared/CustomTextInput";
import { ConstructionSelect } from "@/components/editor/EnergyPanel";
import { LocationSection } from "@/components/editor/LocationSection";
import { ZonesSection } from "@/components/editor/ZonesSection";
import { SourceNote } from "@/components/editor/SourceNote";
import { WindowTypePicker } from "@/components/editor/WindowTypePicker";
import { NotesSection } from "@/components/editor/NotesSection";
import { noteTargetOf, targetLabel } from "@/components/editor/noteTarget";
import { effectiveWallThickness } from "@/geometry/layers";
import { interiorWallThickness, interiorWallType } from "@/geometry/constructions";
import { buildRoof, roofOf } from "@/geometry/roof";
import { selectTotalFloorArea, selectTotalHeight } from "@/store/selectors";
import {
  roomHeatLoads,
  suggestHeatPumpPower,
  suggestRadiatorPower,
  validateRadiator,
} from "@/geometry/hvac";
import { pointInPolygon } from "@/geometry/polygon";

const openingErrorKey: Record<OpeningError, MessageKey> = {
  outsideWallStart: "opening.error.outsideWallStart",
  outsideWallEnd: "opening.error.outsideWallEnd",
  tooSmall: "opening.error.tooSmall",
  overlaps: "opening.error.overlaps",
  tooTall: "opening.error.tooTall",
  doorNotOnFloor: "opening.error.doorNotOnFloor",
  negativeSill: "opening.error.negativeSill",
  nonFinite: "opening.error.nonFinite",
};

/**
 * The properties panel at the right of the editor: what is picked, or with nothing picked the
 * building itself. Calculations (energy, variants) live on the Variants step, the history
 * behind the clock in the top bar, the files in the survey list on the left.
 */
export function RightPanel() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  return (
    <aside
      aria-label={t("a11y.rightPanel")}
      className="pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden border-l border-line bg-paper"
    >
      <PanelHeader />
      {/* The gutter stays when there is nothing to scroll, so the content never jumps sideways. */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {selection ? (
          <CustomSection title={t("panel.properties")} first>
            <Properties selection={selection} />
          </CustomSection>
        ) : (
          <BuildingCard />
        )}
      </div>
      <NotesDock target={noteTargetOf(selection)} />
    </aside>
  );
}

/**
 * The notes, always on screen at the foot of the panel, about whatever is picked (the
 * building when nothing is): the properties above scroll on their own, so a note can be read
 * and written beside them. At most a bit under half the panel, so the properties keep room.
 */
function NotesDock({ target }: { target: NoteTarget }) {
  const t = useT();
  const building = useEditorStore((s) => s.building);
  const what = targetLabel(building, target, t);
  return (
    <section
      aria-label={t("notes.title")}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-line bg-paper"
    >
      <header className="flex h-11 shrink-0 items-center px-4">
        <SectionLabel>{what ? t("notes.on", { what }) : t("notes.building")}</SectionLabel>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        <Notes target={target} />
      </div>
    </section>
  );
}

/** The building name, and its storeys and floor area in grey below it, as the 20° app heads its panel. */
function PanelHeader() {
  const t = useT();
  const name = useEditorStore((s) => s.building.name);
  const storeys = useEditorStore((s) => s.building.storeys.length);
  const floorArea = useEditorStore(selectTotalFloorArea);
  const language = useEditorStore((s) => s.language);
  return (
    <header className="border-b border-line px-5 pt-4 pb-3.5">
      <h2 className="truncate text-lg font-semibold text-ink">{name}</h2>
      <p className="mt-0.5 truncate text-sm text-faint">
        {floorArea > 0
          ? t("panel.subtitle", { storeys, area: formatArea(floorArea, language) })
          : t("panel.subtitleStoreys", { storeys })}
      </p>
    </header>
  );
}

/**
 * Nothing selected: the building itself in the 20° sections, building, dimensions and
 * location, with width and depth editable while the footprint is a box.
 */
function BuildingCard() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const renameBuilding = useEditorStore((s) => s.renameBuilding);
  const setWallThickness = useEditorStore((s) => s.setWallThickness);
  const select = useEditorStore((s) => s.select);
  const resizeFootprint = useEditorStore((s) => s.resizeFootprint);
  const eave = useEditorStore(selectTotalHeight);
  const floorArea = useEditorStore(selectTotalFloorArea);
  const batch = useBatch();
  const box = rectangleOf(building.footprint);
  const m = t("common.metres");
  const roof = roofOf(building);
  const ridge = eave + buildRoof(building, eave).ridgeHeight;
  return (
    <>
      <CustomSection title={t("card.building")} first>
        <p className="text-sm text-muted">{t("properties.empty")}</p>
        <CustomTextInput
          label={t("building.name")}
          value={building.name}
          onCommit={renameBuilding}
        />
        <CustomNumberInput
          label={t("settings.wallThickness")}
          value={building.wallThickness}
          min={0.1}
          max={1}
          step={0.05}
          unit={m}
          language={language}
          onChange={setWallThickness}
          {...batch}
        />
        <CustomReadOnly label={t("status.storeys")} value={String(building.storeys.length)} />
        <CustomReadOnly label={t("card.floorArea")} value={formatArea(floorArea, language)} />
        <CustomReadOnly
          label={t("roof.kind")}
          value={
            roof.kind === "flat"
              ? t("roof.flat")
              : `${t(`roof.${roof.kind}`)}, ${formatNumber(roof.pitch, language, 0)}°`
          }
        />
        <CustomButton
          variant="quiet"
          flush
          className="self-start"
          onClick={() => {
            select({ kind: "roof" });
          }}
        >
          {t("card.editRoof")}
        </CustomButton>
      </CustomSection>
      <CustomSection title={t("card.dimensions")}>
        {box ? (
          <>
            <CustomNumberInput
              label={t("building.width")}
              value={box.width}
              min={BOX_LIMITS.width.min}
              max={BOX_LIMITS.width.max}
              step={0.1}
              unit={m}
              language={language}
              onChange={(width) => {
                resizeFootprint(width, box.depth);
              }}
              {...batch}
            />
            <CustomNumberInput
              label={t("building.depth")}
              value={box.depth}
              min={BOX_LIMITS.depth.min}
              max={BOX_LIMITS.depth.max}
              step={0.1}
              unit={m}
              language={language}
              onChange={(depth) => {
                resizeFootprint(box.width, depth);
              }}
              {...batch}
            />
          </>
        ) : (
          <Hint>{t("building.notRectangle")}</Hint>
        )}
        <CustomReadOnly
          label={t("footprint.area")}
          value={formatArea(area(building.footprint), language)}
        />
        <CustomReadOnly label={t("card.eaveHeight")} value={formatMetres(eave, language)} />
        <CustomReadOnly label={t("card.ridgeHeight")} value={formatMetres(ridge, language)} />
      </CustomSection>
      <LocationSection collapsible />
      <ZonesSection />
    </>
  );
}

function Properties({ selection }: { selection: Selection }) {
  switch (selection.kind) {
    case "vertex":
      return <VertexProperties index={selection.index} />;
    case "wall":
      return <WallProperties storeyId={selection.storeyId} wallIndex={selection.wallIndex} />;
    case "opening":
      return <OpeningProperties storeyId={selection.storeyId} openingId={selection.id} />;
    case "interiorWall":
      return <InteriorWallProperties storeyId={selection.storeyId} index={selection.index} />;
    case "room":
      return <RoomProperties storeyId={selection.storeyId} roomId={selection.id} />;
    case "storey":
      return <StoreyProperties storeyId={selection.id} />;
    case "zone":
      return <ZoneProperties zoneId={selection.id} />;
    case "roof":
      return <RoofProperties />;
    case "radiator":
      return <RadiatorProperties storeyId={selection.storeyId} id={selection.id} />;
    case "heatPump":
      return <HeatPumpProperties id={selection.id} />;
    case "pipe":
      return <PipeProperties storeyId={selection.storeyId} id={selection.id} />;
    case "measurement":
      return <MeasurementProperties storeyId={selection.storeyId} id={selection.id} />;
  }
}

function RadiatorProperties({ storeyId, id }: { storeyId: string; id: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const storey = useStorey(storeyId);
  const updateRadiator = useEditorStore((s) => s.updateRadiator);
  const removeRadiator = useEditorStore((s) => s.removeRadiator);
  const batch = useBatch();
  const rad = storey?.radiators?.find((r) => r.id === id);
  const edge = rad ? edges(building.footprint)[rad.wallIndex] : undefined;
  const loads = useMemo(() => roomHeatLoads(building), [building]);
  if (!storey || !rad || !edge) return null;
  const valid = validateRadiator(rad, storey, edge.length);
  const behind = {
    x: edge.a.x + edge.direction.x * (rad.offset + rad.width / 2) - edge.normal.x * 0.05,
    y: edge.a.y + edge.direction.y * (rad.offset + rad.width / 2) - edge.normal.y * 0.05,
  };
  const room = storey.rooms.find((r) => pointInPolygon(behind, r.polygon));
  const load = room ? loads.find((l) => l.roomId === room.id) : undefined;
  const m = t("common.metres");
  const patch = (p: Partial<Omit<Radiator, "id">>) => {
    updateRadiator(storeyId, id, p);
  };
  return (
    <>
      <Title>{t("hvac.radiator")}</Title>
      <Presence show={!valid}>
        <Notice tone="warning">{t("hvac.invalid")}</Notice>
      </Presence>
      <CustomNumberInput
        label={t("opening.offset")}
        value={rad.offset}
        min={0}
        max={Math.max(0, edge.length - rad.width)}
        step={0.1}
        unit={m}
        language={language}
        invalid={!valid}
        onChange={(offset) => {
          patch({ offset });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("opening.width")}
        value={rad.width}
        min={0.2}
        max={edge.length}
        step={0.1}
        unit={m}
        language={language}
        invalid={!valid}
        onChange={(width) => {
          patch({ width });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("opening.height")}
        value={rad.height}
        min={0.2}
        max={storey.height}
        step={0.05}
        unit={m}
        language={language}
        onChange={(height) => {
          patch({ height });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("hvac.power")}
        value={rad.power}
        min={100}
        max={5000}
        step={50}
        unit="W"
        language={language}
        onChange={(power) => {
          patch({ power });
        }}
        {...batch}
      />
      <Presence value={load} className="flex flex-col gap-3.5">
        {(load) => (
          <>
            <CustomReadOnly
              label={`${t("hvac.heatLoad")} (${load.name})`}
              value={`${formatNumber(load.load, language, 0)} W`}
            />
            <CustomReadOnly
              label={t("hvac.suggested")}
              value={`${formatNumber(suggestRadiatorPower(load.load), language, 0)} W`}
            />
          </>
        )}
      </Presence>
      <RemoveButton
        label={t("hvac.removeRadiator")}
        onClick={() => {
          removeRadiator(storeyId, id);
        }}
      />
    </>
  );
}

function HeatPumpProperties({ id }: { id: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const updateHeatPump = useEditorStore((s) => s.updateHeatPump);
  const removeHeatPump = useEditorStore((s) => s.removeHeatPump);
  const batch = useBatch();
  const pump = building.heatPumps?.find((p) => p.id === id);
  if (!pump) return null;
  const suggested = suggestHeatPumpPower(building);
  // Room for the building's own suggestion and half again, at least 60 kW: a block of flats
  // needs far more than a house, and the slider must reach what the pump already has.
  const maxPower = Math.max(60, Math.ceil((suggested * 1.5) / 10) * 10, Math.ceil(pump.power));
  return (
    <>
      <Title>{t("hvac.heatPump")}</Title>
      <CustomFieldGroup label={t("hvac.kind")}>
        <CustomSegmented
          label={t("hvac.kind")}
          value={pump.kind}
          options={[
            { value: "air", label: t("hvac.air") },
            { value: "ground", label: t("hvac.ground") },
          ]}
          onChange={(kind) => {
            updateHeatPump(id, { kind });
          }}
        />
      </CustomFieldGroup>
      <CustomNumberInput
        label={t("hvac.powerKw")}
        value={pump.power}
        min={2}
        max={maxPower}
        step={0.5}
        unit="kW"
        language={language}
        onChange={(power) => {
          updateHeatPump(id, { power });
        }}
        {...batch}
      />
      <CustomReadOnly
        label={t("hvac.pumpSuggestion")}
        value={`${formatNumber(suggested, language, 1)} kW`}
      />
      <CustomNumberInput
        label={t("vertex.x")}
        value={pump.position.x}
        min={-50}
        max={50}
        step={0.5}
        unit={t("common.metres")}
        language={language}
        onChange={(x) => {
          updateHeatPump(id, { position: { x, y: pump.position.y } });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("vertex.y")}
        value={pump.position.y}
        min={-50}
        max={50}
        step={0.5}
        unit={t("common.metres")}
        language={language}
        onChange={(y) => {
          updateHeatPump(id, { position: { x: pump.position.x, y } });
        }}
        {...batch}
      />
      <RemoveButton
        label={t("common.remove")}
        onClick={() => {
          removeHeatPump(id);
        }}
      />
    </>
  );
}

function PipeProperties({ storeyId, id }: { storeyId: string; id: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const storey = useStorey(storeyId);
  const removePipe = useEditorStore((s) => s.removePipe);
  const pipe = storey?.pipes?.find((p) => p.id === id);
  if (!pipe) return null;
  const length = pipe.points.reduce(
    (s, p, i) => (i === 0 ? 0 : s + distance(pipe.points[i - 1] ?? p, p)),
    0,
  );
  return (
    <>
      <Title>{t("hvac.pipe")}</Title>
      <CustomReadOnly label={t("hvac.length")} value={formatMetres(length, language)} />
      <RemoveButton
        label={t("common.remove")}
        onClick={() => {
          removePipe(storeyId, id);
        }}
      />
    </>
  );
}

function MeasurementProperties({ storeyId, id }: { storeyId: string; id: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const storey = useStorey(storeyId);
  const removeMeasurement = useEditorStore((s) => s.removeMeasurement);
  const m = storey?.measurements?.find((x) => x.id === id);
  if (!m) return null;
  return (
    <>
      <Title>{t("measurement.title")}</Title>
      <CustomReadOnly
        label={t("measurement.length")}
        value={formatMetres(distance(m.a, m.b), language)}
      />
      <Hint>{t("measurement.hint")}</Hint>
      <RemoveButton
        label={t("common.remove")}
        onClick={() => {
          removeMeasurement(storeyId, id);
        }}
      />
    </>
  );
}

function RoofProperties() {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const setRoof = useEditorStore((s) => s.setRoof);
  const batch = useBatch();
  const roof = roofOf(building);
  const geo = buildRoof(building, 0);
  const m = t("common.metres");
  return (
    <>
      <Title>{t("roof.title")}</Title>
      <SourceNote path="roof" />
      <CustomFieldGroup label={t("roof.kind")}>
        <CustomSegmented
          label={t("roof.kind")}
          value={roof.kind}
          options={[
            { value: "flat", label: t("roof.flat") },
            { value: "gable", label: t("roof.gable") },
            { value: "hip", label: t("roof.hip") },
          ]}
          onChange={(kind) => {
            setRoof({ kind });
          }}
        />
      </CustomFieldGroup>
      {roof.kind === "flat" ? (
        <CustomNumberInput
          label={t("roof.parapet")}
          value={roof.parapet}
          min={0}
          max={1.5}
          step={0.05}
          unit={m}
          language={language}
          onChange={(parapet) => {
            setRoof({ parapet });
          }}
          {...batch}
        />
      ) : (
        <>
          <Presence show={geo.kind === "hip" && geo.builtKind !== "hip"}>
            <Hint error>{t("roof.hipFallback")}</Hint>
          </Presence>
          <CustomNumberInput
            label={t("roof.pitch")}
            value={roof.pitch}
            min={5}
            max={75}
            step={1}
            unit="°"
            language={language}
            onChange={(pitch) => {
              setRoof({ pitch });
            }}
            {...batch}
          />
          <CustomNumberInput
            label={t("roof.overhang")}
            value={roof.overhang}
            min={0}
            max={1.5}
            step={0.05}
            unit={m}
            language={language}
            onChange={(overhang) => {
              setRoof({ overhang });
            }}
            {...batch}
          />
          <CustomFieldGroup label={t("roof.ridgeAxis")}>
            <CustomSegmented
              label={t("roof.ridgeAxis")}
              value={roof.ridgeAxis}
              options={[
                { value: "x", label: "X" },
                { value: "y", label: "Y" },
              ]}
              onChange={(ridgeAxis) => {
                setRoof({ ridgeAxis });
              }}
            />
          </CustomFieldGroup>
          <CustomCheckbox
            variant="switch"
            label={t("roof.heatedAttic")}
            checked={roof.heatedAttic}
            onChange={(heatedAttic) => {
              setRoof({ heatedAttic });
            }}
          />
          <CustomReadOnly
            label={t("roof.ridgeHeight")}
            value={formatMetres(geo.ridgeHeight, language)}
          />
          <CustomReadOnly
            label={t("roof.atticVolume")}
            value={`${formatNumber(geo.atticVolume, language, 1)} m³`}
          />
        </>
      )}
      <CustomReadOnly label={t("roof.area")} value={formatArea(geo.area, language)} />
    </>
  );
}

function useStorey(storeyId: string): Storey | undefined {
  return useEditorStore((s) => s.building.storeys.find((st) => st.id === storeyId));
}

function useBatch() {
  const beginBatch = useEditorStore((s) => s.beginBatch);
  const endBatch = useEditorStore((s) => s.endBatch);
  return { onGestureStart: beginBatch, onGestureEnd: endBatch };
}

function Title({ children }: { children: string }) {
  return <h3 className="font-display text-lg font-semibold text-ink">{children}</h3>;
}

function RemoveButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <CustomButton
      variant="danger"
      icon={<Trash2 size={14} />}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="mt-2 self-start"
    >
      {label}
    </CustomButton>
  );
}

function VertexProperties({ index }: { index: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const footprint = useEditorStore((s) => s.building.footprint);
  const setFootprintVertex = useEditorStore((s) => s.setFootprintVertex);
  const removeFootprintVertex = useEditorStore((s) => s.removeFootprintVertex);
  const batch = useBatch();
  const vertex = footprint[index];
  if (!vertex) return null;
  const m = t("common.metres");
  return (
    <>
      <Title>{t("vertex.title", { n: index + 1 })}</Title>
      <CustomNumberInput
        label={t("vertex.x")}
        value={vertex.x}
        min={-50}
        max={50}
        step={0.5}
        unit={m}
        language={language}
        onChange={(x) => {
          setFootprintVertex(index, { x, y: vertex.y });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("vertex.y")}
        value={vertex.y}
        min={-50}
        max={50}
        step={0.5}
        unit={m}
        language={language}
        onChange={(y) => {
          setFootprintVertex(index, { x: vertex.x, y });
        }}
        {...batch}
      />
      <RemoveButton
        label={t("vertex.remove")}
        disabled={footprint.length <= 3}
        title={footprint.length <= 3 ? t("vertex.cannotRemove") : undefined}
        onClick={() => {
          removeFootprintVertex(index);
        }}
      />
    </>
  );
}

function WallProperties({ storeyId, wallIndex }: { storeyId: string; wallIndex: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const footprint = useEditorStore((s) => s.building.footprint);
  const thickness = useEditorStore((s) => effectiveWallThickness(s.building));
  const wallConstructionId = useEditorStore((s) => s.building.wallConstructionId);
  const shared = useEditorStore((s) => (s.building.sharedEdges ?? []).includes(wallIndex));
  const setEdgeShared = useEditorStore((s) => s.setEdgeShared);
  const openPhoto = useEditorStore((s) => s.setPhotoWall);
  const storey = useStorey(storeyId);
  const edge = edges(footprint)[wallIndex];
  if (!edge || !storey) return null;
  const onWall = openingsOn(storey.openings, wallIndex);
  const validOpenings = onWall.filter(
    (opening) =>
      validateOpening(opening, {
        wallLength: edge.length,
        storeyHeight: storey.height,
        siblings: storey.openings,
      }).length === 0,
  );
  const netArea =
    edge.length * storey.height - validOpenings.reduce((a, o) => a + o.width * o.height, 0);
  return (
    <>
      <Title>{t("wall.title", { n: wallIndex + 1, storey: storey.name })}</Title>
      <CustomReadOnly label={t("wall.length")} value={formatMetres(edge.length, language)} />
      <CustomReadOnly label={t("wall.thickness")} value={formatMetres(thickness, language)} />
      <CustomReadOnly label={t("wall.openings")} value={String(onWall.length)} />
      <CustomCheckbox
        label={t("wall.shared")}
        checked={shared}
        onChange={(next) => {
          setEdgeShared(wallIndex, next);
        }}
      />
      <Presence show={shared}>
        <Hint>{t("wall.sharedHint")}</Hint>
      </Presence>
      <SourceNote path={shared ? "sharedEdges" : "footprint"} />
      <CustomButton
        icon={<Camera size={15} aria-hidden />}
        onClick={() => {
          openPhoto(wallIndex);
        }}
      >
        {t("wallPhoto.open")}
      </CustomButton>
      <Hint>{t("wallPhoto.openHint")}</Hint>
      <Presence show={onWall.some((o) => o.kind === "window")}>
        <WindowTypePicker storeyId={storeyId} wallIndex={wallIndex} />
      </Presence>
      <WallPhotoControls wallIndex={wallIndex} />
      <ConstructionSelect
        category="wall"
        value={wallConstructionId}
        area={Math.max(0, netArea)}
        target={{ kind: "wall" }}
      />
      <Hint>{t("wall.hint")}</Hint>
    </>
  );
}

/** For a wall that carries its straightened facade photo in 3D: how see-through, or remove it. */
function WallPhotoControls({ wallIndex }: { wallIndex: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const hasPhoto = useEditorStore((s) => s.facadePhotos[wallIndex] !== undefined);
  const transparency = useEditorStore((s) => s.facadePhotoTransparency);
  const setTransparency = useEditorStore((s) => s.setFacadePhotoTransparency);
  const setFacadePhoto = useEditorStore((s) => s.setFacadePhoto);
  if (!hasPhoto) return null;
  return (
    <>
      <CustomSlider
        label={t("wallPhoto.transparency")}
        value={transparency}
        min={0}
        max={100}
        step={5}
        onChange={setTransparency}
        format={(pct) => `${formatNumber(pct, language)} %`}
      />
      <CustomButton
        variant="danger"
        icon={<Trash2 size={15} aria-hidden />}
        onClick={() => {
          setFacadePhoto(wallIndex, null);
          // The project keeps its photos until the user removes one here.
          const ref = currentProjectRef();
          if (ref) void removePhoto(ref, String(wallIndex));
        }}
      >
        {t("wallPhoto.removePhoto")}
      </CustomButton>
    </>
  );
}

function OpeningProperties({ storeyId, openingId }: { storeyId: string; openingId: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const footprint = useEditorStore((s) => s.building.footprint);
  const storey = useStorey(storeyId);
  const updateOpening = useEditorStore((s) => s.updateOpening);
  const removeOpening = useEditorStore((s) => s.removeOpening);
  const windowConstructionId = useEditorStore((s) => s.building.windowConstructionId);
  const doorConstructionId = useEditorStore((s) => s.building.doorConstructionId);
  const batch = useBatch();
  const opening = storey?.openings.find((o) => o.id === openingId);
  const wallLength =
    !opening || !storey
      ? undefined
      : opening.interior
        ? (() => {
            const seg = storey.interiorWalls[opening.wallIndex];
            return seg ? distance(seg.a, seg.b) : undefined;
          })()
        : edges(footprint)[opening.wallIndex]?.length;
  if (!storey || !opening || wallLength === undefined) return null;
  const errors = validateOpening(opening, {
    wallLength,
    storeyHeight: storey.height,
    siblings: storey.openings,
  });
  const has = (...codes: OpeningError[]) => errors.some((e) => codes.includes(e));
  const patch = (p: Partial<Omit<Opening, "id">>) => {
    updateOpening(storeyId, openingId, p);
  };
  const m = t("common.metres");
  return (
    <>
      <Title>{t(opening.kind === "door" ? "opening.door" : "opening.window")}</Title>
      <Presence value={errors.length > 0 ? errors : null}>
        {(list) => (
          <Notice tone="warning">
            <p className="font-medium">{t("opening.invalid")}</p>
            <ul className="mt-1 list-disc pl-4">
              {list.map((e) => (
                <li key={e}>{t(openingErrorKey[e])}</li>
              ))}
            </ul>
          </Notice>
        )}
      </Presence>
      <CustomFieldGroup label={t("opening.kind")}>
        <CustomSegmented
          label={t("opening.kind")}
          value={opening.kind}
          options={[
            { value: "window", label: t("opening.window") },
            { value: "door", label: t("opening.door") },
          ]}
          onChange={(kind) => {
            const constructionId = kind === "door" ? doorConstructionId : windowConstructionId;
            patch(kind === "door" ? { kind, sill: 0, constructionId } : { kind, constructionId });
          }}
        />
      </CustomFieldGroup>
      <CustomNumberInput
        label={t("opening.offset")}
        value={opening.offset}
        min={0}
        max={Math.max(0, wallLength - opening.width)}
        step={0.1}
        unit={m}
        language={language}
        invalid={has("outsideWallStart", "outsideWallEnd", "overlaps")}
        onChange={(offset) => {
          patch({ offset });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("opening.width")}
        value={opening.width}
        min={0.1}
        max={wallLength}
        step={0.1}
        unit={m}
        language={language}
        invalid={has("outsideWallEnd", "overlaps", "tooSmall")}
        onChange={(width) => {
          patch({ width });
        }}
        {...batch}
      />
      <CustomNumberInput
        label={t("opening.height")}
        value={opening.height}
        min={0.1}
        max={storey.height}
        step={0.1}
        unit={m}
        language={language}
        invalid={has("tooTall", "tooSmall")}
        onChange={(height) => {
          patch({ height });
        }}
        {...batch}
      />
      <Presence show={opening.kind === "window"}>
        <CustomNumberInput
          label={t("opening.sill")}
          value={opening.sill}
          min={0}
          max={Math.max(0, storey.height - opening.height)}
          step={0.1}
          unit={m}
          language={language}
          invalid={has("tooTall", "negativeSill")}
          onChange={(sill) => {
            patch({ sill });
          }}
          {...batch}
        />
      </Presence>
      <Presence show={!opening.interior} className="flex flex-col gap-3.5">
        <ConstructionSelect
          category={opening.kind}
          value={opening.constructionId}
          area={opening.width * opening.height}
          target={{ kind: "opening", storeyId, id: openingId }}
        />
      </Presence>
      <Presence show={!opening.interior && opening.kind === "window"}>
        <WindowTypePicker
          storeyId={storeyId}
          openingId={openingId}
          wallIndex={opening.wallIndex}
          currentId={opening.constructionId}
        />
      </Presence>
      <SourceNote path={`opening:${openingId}`} />
      <RemoveButton
        label={t("opening.remove")}
        onClick={() => {
          removeOpening(storeyId, openingId);
        }}
      />
    </>
  );
}

function InteriorWallProperties({ storeyId, index }: { storeyId: string; index: number }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const storey = useStorey(storeyId);
  const removeInteriorWall = useEditorStore((s) => s.removeInteriorWall);
  const setInteriorWallType = useEditorStore((s) => s.setInteriorWallType);
  const constructions = useEditorStore((s) => s.building.constructions);
  const segment = storey?.interiorWalls[index];
  if (!segment) return null;
  return (
    <>
      <Title>{t("interiorWall.title")}</Title>
      <CustomSelect
        label={t("interiorWall.type")}
        value={interiorWallType(constructions, segment).id}
        options={constructions
          .filter((c) => c.category === "interiorWall")
          .map((c) => ({ value: c.id, label: c.name, detail: String(c.uValue) }))}
        onChange={(id) => {
          setInteriorWallType(storeyId, index, id);
        }}
      />
      <CustomReadOnly
        label={t("interiorWall.thickness")}
        value={`${formatNumber(interiorWallThickness(constructions)(segment) * 100, language, 1)} cm`}
      />
      <CustomReadOnly
        label={t("interiorWall.length")}
        value={formatMetres(distance(segment.a, segment.b), language)}
      />
      <CustomReadOnly
        label={t("wall.openings")}
        value={String(openingsOn(storey.openings, index, true).length)}
      />
      <Hint>{t("interiorWall.hint")}</Hint>
      <RemoveButton
        label={t("interiorWall.remove")}
        onClick={() => {
          removeInteriorWall(storeyId, index);
        }}
      />
    </>
  );
}

function RoomProperties({ storeyId, roomId }: { storeyId: string; roomId: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const zones = useEditorStore((s) => s.building.zones);
  const storey = useStorey(storeyId);
  const renameRoom = useEditorStore((s) => s.renameRoom);
  const assignRoomToZone = useEditorStore((s) => s.assignRoomToZone);
  const room: Room | undefined = storey?.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  return (
    <>
      <Title>{t("room.title")}</Title>
      <CustomTextInput
        label={t("room.name")}
        value={room.name}
        onCommit={(name) => {
          renameRoom(storeyId, roomId, name);
        }}
      />
      <CustomReadOnly label={t("room.area")} value={formatArea(room.area, language)} />
      <CustomSelect
        label={t("room.zone")}
        value={room.zoneId ?? ""}
        options={[
          { value: "", label: t("zone.none") },
          ...zones.map((z: Zone) => ({ value: z.id, label: z.name, color: z.color })),
        ]}
        onChange={(id) => {
          assignRoomToZone(storeyId, roomId, id === "" ? undefined : id);
        }}
      />
    </>
  );
}

function StoreyProperties({ storeyId }: { storeyId: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const storey = useStorey(storeyId);
  const renameStorey = useEditorStore((s) => s.renameStorey);
  const setStoreyHeight = useEditorStore((s) => s.setStoreyHeight);
  const removeStorey = useEditorStore((s) => s.removeStorey);
  const batch = useBatch();
  if (!storey) return null;
  const area = storey.rooms.reduce((s, r) => s + r.area, 0);
  return (
    <>
      <Title>{t("storey.title")}</Title>
      <CustomTextInput
        label={t("storey.name")}
        value={storey.name}
        onCommit={(name) => {
          renameStorey(storeyId, name);
        }}
      />
      <CustomNumberInput
        label={t("storey.height")}
        value={storey.height}
        min={2}
        max={6}
        step={0.01}
        unit={t("common.metres")}
        language={language}
        onChange={(h) => {
          setStoreyHeight(storeyId, h);
        }}
        {...batch}
      />
      <CustomReadOnly label={t("storey.openings")} value={String(storey.openings.length)} />
      <CustomReadOnly label={t("storey.rooms")} value={String(storey.rooms.length)} />
      <CustomReadOnly label={t("room.area")} value={formatArea(area, language)} />
      <SourceNote path="storeys" />
      <RemoveButton
        label={t("storey.remove")}
        onClick={() => {
          removeStorey(storeyId);
        }}
      />
    </>
  );
}

function ZoneProperties({ zoneId }: { zoneId: string }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const zone = useEditorStore((s) => s.building.zones.find((z) => z.id === zoneId));
  const roomCount = useEditorStore((s) =>
    s.building.storeys.reduce((n, st) => n + st.rooms.filter((r) => r.zoneId === zoneId).length, 0),
  );
  const updateZone = useEditorStore((s) => s.updateZone);
  const removeZone = useEditorStore((s) => s.removeZone);
  const setZoneHeated = useEditorStore((s) => s.setZoneHeated);
  if (!zone) return null;
  return (
    <>
      <Title>{t("zone.title")}</Title>
      <CustomTextInput
        label={t("zone.name")}
        value={zone.name}
        onCommit={(name) => {
          updateZone(zoneId, { name });
        }}
      />
      <CustomSwatches
        label={t("zone.color")}
        value={zone.color}
        onChange={(color) => {
          updateZone(zoneId, { color });
        }}
      />
      <CustomCheckbox
        variant="switch"
        label={t(zone.heated ? "zone.heated" : "zone.unheated")}
        checked={zone.heated}
        onChange={(heated) => {
          setZoneHeated(zoneId, heated);
        }}
      />
      <CustomReadOnly
        label={t("zone.temperature")}
        value={`${formatNumber(zone.temperature, language, 0)} °C`}
      />
      <CustomReadOnly label={t("zone.rooms")} value={String(roomCount)} />
      <RemoveButton
        label={t("zone.remove")}
        onClick={() => {
          removeZone(zoneId);
        }}
      />
    </>
  );
}

/** Threads in a server project (shared, with replies), notes in the building otherwise. */
function Notes({ target }: { target: NoteTarget }) {
  const serverProject = useEditorStore((s) => s.projectId !== null);
  return serverProject ? <ThreadsSection target={target} /> : <NotesSection target={target} />;
}
