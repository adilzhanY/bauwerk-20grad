import { Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { useDismiss } from "@/components/shared/useDismiss";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fallBackWhenStyleFails, LIGHT_STYLE } from "@/lib/mapStyle";
import { BarChart3, Box, Layers, Navigation } from "lucide-react";
import { useT } from "@/i18n/useT";
import { coverageUrl, tileUrl } from "@/lod2/api/client";
import { hasWebGL } from "@/lib/webgl";
import { useStore } from "@/lod2/state/store";

/** Below this the API serves no buildings. */
const MIN_BUILDING_ZOOM = 13;
const SELECT = "#024e7b";

/** Tile URLs must be absolute for MapLibre, and `new URL` would escape the placeholders. */
function absolute(template: string): string {
  return `${window.location.origin}${template}`;
}

function selectionFilter(gid: string | null): maplibregl.FilterSpecification {
  return ["==", ["get", "building_gid"], gid ?? ""];
}

/**
 * The map of the start and building pages: LoD2 footprints over basemap.de, the chosen
 * building in navy, white square buttons for aerial imagery, 3D blocks and data coverage,
 * a north arrow, a scale bar and a light mini map with the sources.
 */
export function BuildingMap({
  selectedGid,
  onPick,
  marker,
}: {
  selectedGid: string | null;
  onPick: (gid: string) => void;
  /** A point to show, for example a searched address. */
  marker?: { lon: number; lat: number } | null;
}) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const miniContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const miniRef = useRef<maplibregl.Map | null>(null);
  // Latest props for the map's own event handlers, which are registered once, and the
  // selection for layers created after it was set.
  const pickRef = useRef(onPick);
  const selectedGidRef = useRef(selectedGid);
  useEffect(() => {
    pickRef.current = onPick;
    selectedGidRef.current = selectedGid;
  });
  const [bearing, setBearing] = useState(0);
  const [aerial, setAerial] = useState(false);
  const [extruded, setExtruded] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesRoot = useRef<HTMLDivElement>(null);
  useDismiss(sourcesOpen, sourcesRoot, () => {
    setSourcesOpen(false);
  });
  const view = useStore((s) => s.view);

  const [webgl] = useState(() => hasWebGL());

  useEffect(() => {
    if (!container.current || map.current || !webgl) return;
    const start = useStore.getState().view;
    const m = new maplibregl.Map({
      container: container.current,
      style: LIGHT_STYLE,
      center: [start.lon, start.lat],
      zoom: start.zoom,
      maxZoom: 20,
      attributionControl: false,
    });
    map.current = m;
    fallBackWhenStyleFails(m);
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");

    m.on("load", () => {
      m.addSource("coverage", {
        type: "vector",
        tiles: [absolute(coverageUrl)],
        minzoom: 8,
        maxzoom: 14,
      });
      m.addLayer({
        id: "coverage",
        type: "fill",
        source: "coverage",
        "source-layer": "coverage",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "match",
            ["get", "status"],
            "ready",
            "#2aa55a",
            "fetching",
            "#f2a93b",
            "failed",
            "#e23b3b",
            "#9aa0a6",
          ],
          "fill-opacity": 0.22,
        },
      });
      m.addSource("aerial", {
        type: "raster",
        tiles: [absolute("/api/aerial/{z}/{x}/{y}.jpg")],
        tileSize: 256,
        minzoom: 8,
        maxzoom: 20,
      });
      m.addLayer({
        id: "aerial",
        type: "raster",
        source: "aerial",
        layout: { visibility: "none" },
      });
      m.addSource("buildings", {
        type: "vector",
        tiles: [absolute(tileUrl)],
        minzoom: MIN_BUILDING_ZOOM,
        maxzoom: 18,
        promoteId: "gid",
      });
      m.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        paint: {
          "fill-color": SELECT,
          "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.14, 0.04],
        },
      });
      m.addLayer({
        id: "buildings-outline",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        paint: { "line-color": "#7f90a2", "line-opacity": 0.6, "line-width": 0.6 },
      });
      m.addLayer({
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "buildings",
        "source-layer": "buildings",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": "#cfd6dd",
          "fill-extrusion-height": ["coalesce", ["get", "ridge_height"], 10],
          "fill-extrusion-opacity": 0.85,
        },
      });
      m.addLayer({
        id: "buildings-selected-fill",
        type: "fill",
        source: "buildings",
        "source-layer": "buildings",
        filter: selectionFilter(selectedGidRef.current),
        paint: { "fill-color": SELECT, "fill-opacity": 0.35 },
      });
      m.addLayer({
        id: "buildings-selected",
        type: "line",
        source: "buildings",
        "source-layer": "buildings",
        filter: selectionFilter(selectedGidRef.current),
        paint: { "line-color": SELECT, "line-width": 2.5 },
      });
    });

    let hovered: string | number | null = null;
    const setHover = (feature: MapGeoJSONFeature | null) => {
      const id = feature?.id ?? null;
      if (id === hovered) return;
      if (hovered !== null)
        m.setFeatureState(
          { source: "buildings", sourceLayer: "buildings", id: hovered },
          { hover: false },
        );
      hovered = id;
      if (id !== null)
        m.setFeatureState({ source: "buildings", sourceLayer: "buildings", id }, { hover: true });
      m.getCanvas().style.cursor = id !== null ? "pointer" : "";
    };
    m.on("mousemove", "buildings-fill", (e) => {
      setHover(e.features?.[0] ?? null);
    });
    m.on("mouseleave", "buildings-fill", () => {
      setHover(null);
    });
    m.on("click", "buildings-fill", (e) => {
      const gid = e.features?.[0]?.properties.building_gid as string | undefined;
      if (gid) pickRef.current(gid);
    });
    m.on("rotate", () => {
      setBearing(m.getBearing());
    });
    m.on("moveend", () => {
      const c = m.getCenter();
      useStore.getState().setView({ lon: c.lng, lat: c.lat, zoom: m.getZoom() });
    });

    return () => {
      m.remove();
      map.current = null;
    };
  }, [webgl]);

  useEffect(() => {
    const m = map.current;
    if (!m?.getLayer("buildings-selected")) return;
    m.setFilter("buildings-selected", selectionFilter(selectedGid));
    m.setFilter("buildings-selected-fill", selectionFilter(selectedGid));
  }, [selectedGid]);

  // Follow the view when something else moves it (a search result, a building page).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter();
    const moved = Math.abs(c.lng - view.lon) > 1e-6 || Math.abs(c.lat - view.lat) > 1e-6;
    if (moved && !m.isMoving())
      m.flyTo({ center: [view.lon, view.lat], zoom: view.zoom, speed: 1.6 });
  }, [view]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!marker) return;
    const dot = document.createElement("div");
    dot.className = "h-4 w-4 rounded-full border-2 border-white bg-select shadow-float";
    markerRef.current = new maplibregl.Marker({ element: dot })
      .setLngLat([marker.lon, marker.lat])
      .addTo(m);
  }, [marker]);

  const setVisible = (layer: string, visible: boolean) => {
    const m = map.current;
    if (m?.getLayer(layer)) m.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  };

  // The light mini map: a second, still map that follows the big one from further out.
  useEffect(() => {
    if (!miniContainer.current || !webgl) return;
    const mini = new maplibregl.Map({
      container: miniContainer.current,
      style: LIGHT_STYLE,
      center: [view.lon, view.lat],
      zoom: Math.max(0, view.zoom - 4),
      interactive: false,
      attributionControl: false,
    });
    miniRef.current = mini;
    fallBackWhenStyleFails(mini);
    return () => {
      mini.remove();
      miniRef.current = null;
    };
    // Created once; the effect below keeps it in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl]);
  useEffect(() => {
    miniRef.current?.jumpTo({ center: [view.lon, view.lat], zoom: Math.max(0, view.zoom - 4) });
  }, [view]);

  return (
    <div className="light-map relative h-full w-full overflow-hidden bg-panel">
      {/* Sized by h-full, never by absolute inset-0: MapLibre gives its container the class
          maplibregl-map, whose unlayered `position: relative` beats Tailwind's layered
          utilities, and an absolute box would collapse to zero height. */}
      <div ref={container} className="h-full w-full" />
      {!webgl && (
        <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-muted">
          {t("map.noWebgl")}
        </p>
      )}
      <div className="absolute top-4 left-4 flex flex-col gap-2.5">
        <MapButton
          label={t("map.aerial")}
          active={aerial}
          onClick={() => {
            setAerial(!aerial);
            setVisible("aerial", !aerial);
          }}
        >
          <Layers size={17} aria-hidden />
        </MapButton>
        <MapButton
          label={t("map.blocks3d")}
          active={extruded}
          onClick={() => {
            const next = !extruded;
            setExtruded(next);
            setVisible("buildings-3d", next);
            map.current?.easeTo({ pitch: next ? 55 : 0, duration: 600 });
          }}
        >
          <Box size={17} aria-hidden />
        </MapButton>
        <MapButton
          label={t("map.coverage")}
          active={coverage}
          onClick={() => {
            setCoverage(!coverage);
            setVisible("coverage", !coverage);
          }}
        >
          <BarChart3 size={17} aria-hidden />
        </MapButton>
      </div>
      <div className="absolute top-4 right-4">
        <MapButton
          label={t("map.north")}
          active={false}
          onClick={() => map.current?.easeTo({ bearing: 0, pitch: extruded ? 55 : 0 })}
        >
          <Navigation
            size={17}
            aria-hidden
            style={{ transform: `rotate(${String(-bearing)}deg)` }}
            fill="currentColor"
          />
        </MapButton>
      </div>
      <div
        ref={sourcesRoot}
        className="absolute right-4 bottom-4 flex w-28 flex-col items-stretch gap-1.5"
      >
        <div
          ref={miniContainer}
          aria-hidden
          className="h-28 overflow-hidden rounded-inner border border-line shadow-float"
        />
        <button
          type="button"
          onClick={() => {
            setSourcesOpen(!sourcesOpen);
          }}
          aria-expanded={sourcesOpen}
          className="rounded-soft border border-line bg-paper px-2 py-0.5 text-xs font-medium text-ink shadow-soft transition-colors hover:bg-panel-2"
        >
          {t("map.sources")}
        </button>
        <Presence show={sourcesOpen} kind="float">
          <Popover className="absolute right-full bottom-0 mr-2 w-80 text-xs leading-relaxed text-muted">
            {t("map.sourcesText")}
          </Popover>
        </Presence>
      </div>
    </div>
  );
}

function MapButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <CustomIconButton
      label={label}
      size="lg"
      variant="floating"
      pressed={active}
      pressedStyle="solid"
      onClick={onClick}
    >
      {children}
    </CustomIconButton>
  );
}
