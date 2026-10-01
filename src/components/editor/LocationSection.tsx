import { Presence } from "@/components/shared/Presence";
import { Hint } from "@/components/shared/Hint";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { epsgForZone, planToLatLon, toUtm } from "@/geometry/geo";
import { centroid } from "@/geometry/polygon";
import { fromGeoJson, toGeoJson } from "@/geometry/geojson";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { formatNumber } from "@/lib/format";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomCheckbox } from "@/components/shared/CustomCheckbox";
import { CustomReadOnly, CustomSection } from "@/components/shared/CustomField";
import { CustomNumberInput } from "@/components/shared/CustomNumberInput";
import { buildingFileName, downloadFile } from "@/lib/download";

const BERLIN = { lat: 52.516275, lon: 13.377704, rotation: 0 };

/** The building's place on the earth. `collapsible` folds it under its title, closed. */
export function LocationSection({ collapsible = false }: { collapsible?: boolean } = {}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const building = useEditorStore((s) => s.building);
  const setOrigin = useEditorStore((s) => s.setOrigin);
  const recentreOrigin = useEditorStore((s) => s.recentreOrigin);
  const footprint = useEditorStore((s) => s.building.footprint);
  const setFootprint = useEditorStore((s) => s.setFootprint);
  const showMap = useEditorStore((s) => s.showMap);
  const setShowMap = useEditorStore((s) => s.setShowMap);
  const mapOpacity = useEditorStore((s) => s.mapOpacity);
  const setMapOpacity = useEditorStore((s) => s.setMapOpacity);
  const beginBatch = useEditorStore((s) => s.beginBatch);
  const endBatch = useEditorStore((s) => s.endBatch);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const origin = building.origin;
  const centrePlan = centroid(footprint);
  const centre = origin ? planToLatLon(centrePlan, origin) : { lat: 0, lon: 0 };

  const onExport = () => {
    if (!origin) return;
    downloadFile(
      JSON.stringify(toGeoJson(building), null, 2),
      buildingFileName(building.name, "geojson", false),
      "application/geo+json",
    );
  };

  const onImport = async (file: File) => {
    const result = fromGeoJson(await file.text());
    if (!result.ok) {
      setError(`geojson.error.${result.error}`);
      return;
    }
    setError(null);
    setFootprint(result.footprint, result.origin);
  };

  const utm = origin ? toUtm(origin) : null;
  const batch = { onGestureStart: beginBatch, onGestureEnd: endBatch };

  return (
    <CustomSection title={t("location.title")} collapsible={collapsible}>
      <CustomCheckbox
        variant="switch"
        label={t("location.enabled")}
        checked={origin !== undefined}
        onChange={(on) => {
          setOrigin(on ? BERLIN : undefined);
        }}
      />
      <Presence value={origin && utm ? { origin, utm } : null} className="flex flex-col gap-3.5">
        {({ origin, utm }) => (
          <>
            <CustomNumberInput
              label={t("location.lat")}
              value={origin.lat}
              min={-90}
              max={90}
              step={0.000001}
              slider={false}
              unit="°"
              language={language}
              onChange={(lat) => {
                setOrigin({ ...origin, lat });
              }}
              {...batch}
            />
            <CustomNumberInput
              label={t("location.lon")}
              value={origin.lon}
              min={-180}
              max={180}
              step={0.000001}
              slider={false}
              unit="°"
              language={language}
              onChange={(lon) => {
                setOrigin({ ...origin, lon });
              }}
              {...batch}
            />
            <CustomNumberInput
              label={t("location.rotation")}
              value={origin.rotation}
              min={0}
              max={359}
              step={1}
              unit="°"
              language={language}
              onChange={(rotation) => {
                setOrigin({ ...origin, rotation });
              }}
              {...batch}
            />
            <CustomCheckbox
              variant="switch"
              label={t("map.show")}
              checked={showMap}
              onChange={setShowMap}
            />
            <Presence show={showMap}>
              <CustomNumberInput
                label={t("map.opacity")}
                value={mapOpacity}
                min={0.1}
                max={1}
                step={0.05}
                language={language}
                onChange={setMapOpacity}
              />
            </Presence>
            <CustomReadOnly
              label={t("location.centre")}
              value={`${formatNumber(centre.lat, language, 6)}° N, ${formatNumber(centre.lon, language, 6)}° E`}
            />
            <CustomButton
              variant="quiet"
              className="self-start"
              disabled={Math.hypot(centrePlan.x, centrePlan.y) < 1e-6}
              onClick={recentreOrigin}
            >
              {t("location.recentre")}
            </CustomButton>
            <Hint>{t("location.recentreHint")}</Hint>
            <CustomReadOnly
              label={`${t("location.utm")} ${utm.zone}${utm.north ? "N" : "S"} (EPSG:${epsgForZone(utm.zone)})`}
              value={`${formatNumber(utm.easting, language, 1)} E, ${formatNumber(utm.northing, language, 1)} N`}
            />
            <CustomButton
              variant="quiet"
              className="self-start"
              icon={<Download size={14} />}
              onClick={onExport}
            >
              {t("location.exportGeoJson")}
            </CustomButton>
          </>
        )}
      </Presence>
      <CustomButton
        variant="quiet"
        className="self-start"
        icon={<Upload size={14} />}
        onClick={() => {
          fileInput.current?.click();
        }}
      >
        {t("location.importGeoJson")}
      </CustomButton>
      <input
        ref={fileInput}
        type="file"
        accept=".geojson,.json,application/geo+json"
        className="hidden"
        aria-label={t("location.importGeoJson")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImport(file);
          e.target.value = "";
        }}
      />
      <Hint>{t("location.importHint")}</Hint>
      <Presence value={error}>{(error) => <Hint error>{t(error)}</Hint>}</Presence>
    </CustomSection>
  );
}
