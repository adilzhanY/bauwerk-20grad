import { Presence } from "@/components/shared/Presence";
import { CustomFieldGroup } from "@/components/shared/CustomField";
import { Hint } from "@/components/shared/Hint";
import { Printer } from "lucide-react";
import { LANGUAGES } from "@/i18n";
import { useT } from "@/i18n/useT";
import { example } from "@/lib/examples";
import type { ExampleId } from "@/lib/examples";
import { startNewProject } from "@/projects/session";
import { useEditorStore } from "@/store/building";
import type { Theme } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { CustomTextInput } from "@/components/shared/CustomTextInput";
import { CustomSlider } from "@/components/shared/CustomSlider";
import { CustomField, CustomReadOnly, CustomSection } from "@/components/shared/CustomField";
import { formatNumber } from "@/lib/format";
import { BERLIN_FALLBACK, daylight, formatClock, formatDay, sunAt } from "@/lib/sunTime";
import { bounds } from "@/geometry/polygon";
import { selectTotalHeight } from "@/store/selectors";
import { useShallow } from "zustand/react/shallow";

function CutControls() {
  const t = useT();
  const height = useEditorStore(selectTotalHeight);
  const { sectionCut, footprint, language, setSectionCut } = useEditorStore(
    useShallow((s) => ({
      sectionCut: s.sectionCut,
      footprint: s.building.footprint,
      language: s.language,
      setSectionCut: s.setSectionCut,
    })),
  );
  const { min, max } = bounds(footprint);
  const range =
    sectionCut.axis === "horizontal"
      ? { min: 0.1, max: Math.max(1, height + 1) }
      : sectionCut.axis === "x"
        ? { min: min.x - 1, max: max.x + 1 }
        : { min: min.y - 1, max: max.y + 1 };
  return (
    <div className="flex flex-col gap-3">
      <CustomCheckbox
        variant="switch"
        label={t("view.sectionCut")}
        checked={sectionCut.enabled}
        onChange={(enabled) => {
          setSectionCut({ enabled });
        }}
      />
      <Presence show={sectionCut.enabled} className="flex flex-col gap-3.5">
        <CustomFieldGroup label={t("view.cutAxis")}>
          <CustomSegmented
            label={t("view.cutAxis")}
            value={sectionCut.axis}
            options={[
              { value: "horizontal", label: t("view.cutHorizontal") },
              { value: "x", label: t("view.cutX") },
              { value: "y", label: t("view.cutY") },
            ]}
            onChange={(axis) => {
              setSectionCut({ axis });
            }}
          />
        </CustomFieldGroup>
        <CustomNumberInput
          label={t("view.cutValue")}
          value={sectionCut.value}
          min={range.min}
          max={range.max}
          step={0.1}
          unit={t("common.metres")}
          language={language}
          onChange={(value) => {
            setSectionCut({ value });
          }}
        />
      </Presence>
    </div>
  );
}

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

function SunControls() {
  const t = useT();
  const { configuredOrigin, sun, language, setSun } = useEditorStore(
    useShallow((s) => ({
      configuredOrigin: s.building.origin,
      sun: s.sun,
      language: s.language,
      setSun: s.setSun,
    })),
  );
  const origin = configuredOrigin ?? { ...BERLIN_FALLBACK, rotation: 0 };
  const pos = sunAt(sun.dayOfYear, sun.minutes, origin.lat, origin.lon);
  const dl = daylight(sun.dayOfYear, origin.lat, origin.lon);
  return (
    <div className="flex flex-col gap-3">
      <CustomCheckbox
        variant="switch"
        label={t("sun.enabled")}
        checked={sun.enabled}
        onChange={(enabled) => {
          setSun({ enabled });
        }}
      />
      <Presence show={sun.enabled} className="flex flex-col gap-3.5">
        <CustomField label={`${t("sun.day")}: ${formatDay(sun.dayOfYear, language)}`}>
          <CustomSlider
            label={t("sun.day")}
            value={sun.dayOfYear}
            min={1}
            max={365}
            step={1}
            onChange={(dayOfYear) => {
              setSun({ dayOfYear });
            }}
            format={(d) => formatDay(d, language)}
          />
        </CustomField>
        <CustomField label={`${t("sun.time")}: ${formatClock(sun.minutes)}`}>
          <CustomSlider
            label={t("sun.time")}
            value={sun.minutes}
            min={0}
            max={1435}
            step={5}
            onChange={(minutes) => {
              setSun({ minutes });
            }}
            format={formatClock}
          />
        </CustomField>
        {pos.elevation > 0 ? (
          <>
            <CustomReadOnly
              label={t("sun.elevation")}
              value={`${formatNumber(pos.elevation, language, 1)}°`}
            />
            <CustomReadOnly
              label={t("sun.azimuth")}
              value={`${formatNumber(pos.azimuth, language, 0)}°`}
            />
          </>
        ) : (
          <Hint>{t("sun.below")}</Hint>
        )}
        <Presence value={dl}>
          {(dl) => (
            <CustomReadOnly
              label={`${t("sun.rise")} / ${t("sun.set")}`}
              value={`${formatClock(dl.sunrise)} / ${formatClock(dl.sunset)}`}
            />
          )}
        </Presence>
      </Presence>
    </div>
  );
}

export function SettingsSection() {
  const t = useT();
  const s = useEditorStore(
    useShallow((state) => ({
      showGrid: state.showGrid,
      setShowGrid: state.setShowGrid,
      planView: state.planView,
      setPlanView: state.setPlanView,
      showUValueBands: state.showUValueBands,
      setShowUValueBands: state.setShowUValueBands,
      showBridges: state.showBridges,
      setShowBridges: state.setShowBridges,
      walkthrough: state.walkthrough,
      setWalkthrough: state.setWalkthrough,
      showMap: state.showMap,
      setShowMap: state.setShowMap,
      hasOrigin: state.building.origin !== undefined,
      theme: state.theme,
      setTheme: state.setTheme,
      buildingName: state.building.name,
      wallThickness: state.building.wallThickness,
      renameBuilding: state.renameBuilding,
      setWallThickness: state.setWallThickness,
      language: state.language,
      setLanguage: state.setLanguage,
      beginBatch: state.beginBatch,
      endBatch: state.endBatch,
    })),
  );
  const themes: Theme[] = ["light", "dark", "system"];

  return (
    <>
      <CustomSection title={t("panel.view")}>
        <CustomCheckbox
          variant="switch"
          label={t("settings.grid")}
          checked={s.showGrid}
          onChange={s.setShowGrid}
        />
        <CustomCheckbox
          variant="switch"
          label={t("settings.mapGround")}
          checked={s.showMap && s.hasOrigin}
          disabled={!s.hasOrigin}
          onChange={s.setShowMap}
        />
        <Presence show={!s.hasOrigin}>
          <Hint className="-mt-1.5">{t("settings.mapNeedsLocation")}</Hint>
        </Presence>
        <CustomCheckbox
          variant="switch"
          label={t("view.plan")}
          checked={s.planView}
          onChange={s.setPlanView}
        />
        <CustomCheckbox
          variant="switch"
          label={t("view.uValueBands")}
          checked={s.showUValueBands}
          onChange={s.setShowUValueBands}
        />
        <CustomCheckbox
          variant="switch"
          label={t("bridges.show")}
          checked={s.showBridges}
          onChange={s.setShowBridges}
        />
        <OtherStoreysControls />
        <SunControls />
        <CutControls />
        <CustomCheckbox
          variant="switch"
          label={t("view.walkthrough")}
          checked={s.walkthrough}
          onChange={s.setWalkthrough}
        />
        <Presence show={s.walkthrough} className="flex flex-col gap-3.5">
          <Hint>{t("view.walkHint")}</Hint>
          <CustomButton id="walk-lock" variant="primary" className="self-start">
            {t("view.walkStart")}
          </CustomButton>
        </Presence>
        <CustomFieldGroup label={t("settings.theme")}>
          <CustomSegmented
            label={t("settings.theme")}
            value={s.theme}
            options={themes.map((v) => ({ value: v, label: t(`theme.${v}`) }))}
            onChange={s.setTheme}
          />
        </CustomFieldGroup>
        <CustomButton
          variant="quiet"
          className="justify-start"
          icon={<Printer size={14} />}
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("print", "1");
            window.open(url.toString(), "_blank");
          }}
        >
          {t("print.open")}
        </CustomButton>
      </CustomSection>
      <CustomSection title={t("panel.settings")}>
        <CustomTextInput
          label={t("building.name")}
          value={s.buildingName}
          onCommit={s.renameBuilding}
        />
        <CustomNumberInput
          label={t("settings.wallThickness")}
          value={s.wallThickness}
          min={0.1}
          max={1}
          step={0.05}
          unit={t("common.metres")}
          language={s.language}
          onChange={s.setWallThickness}
          onGestureStart={s.beginBatch}
          onGestureEnd={s.endBatch}
        />
        <CustomSelect
          label={t("settings.language")}
          value={s.language}
          options={LANGUAGES.map((l) => ({ value: l, label: l === "de" ? "Deutsch" : "English" }))}
          onChange={s.setLanguage}
        />
        <CustomSelect<ExampleId | "">
          label={t("settings.example")}
          value=""
          options={[
            { value: "", label: t("settings.examplePlaceholder") },
            { value: "altbau", label: t("example.altbau") },
            { value: "tower", label: t("example.tower") },
            { value: "house", label: t("example.house") },
            { value: "block", label: t("example.block") },
          ]}
          onChange={(id) => {
            if (id !== "") void startNewProject(example(id, s.language));
          }}
        />
      </CustomSection>
    </>
  );
}
