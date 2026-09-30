import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Card } from "@/components/shared/Card";
import { useEffect, useMemo, useState } from "react";
import { Navigation } from "lucide-react";
import { compassPoint, planToLatLon, toEastNorth } from "@/geometry/geo";
import { centroid } from "@/geometry/polygon";
import { placeTiles } from "@/geometry/tiles";
import { useT } from "@/i18n/useT";
import { reverseAddress } from "@/lod2/api/geocode";
import { useCameraHeading } from "@/scene/cameraHeading";
import { useEditorStore } from "@/store/building";

/** Width and height of the drawing, px. */
const WIDTH = 224;
const HEIGHT = 168;
/** The footprint fills at most this share of the drawing. */
const FILL = 0.55;
/** At least this many metres across, so a small house does not fill the card. */
const MIN_SPAN_M = 36;
/** Street tiles at this zoom: about 0.3 m per pixel in Berlin, streets but no clutter. */
const TILE_ZOOM = 18;

/**
 * The minimap at the bottom left of the 3D view: the footprint in amber, north up, over faint
 * streets when the building has a location. Its button brings the camera back to the 3D
 * view; the footer shows where the camera looks and the place.
 */
export function Minimap() {
  const t = useT();
  const footprint = useEditorStore((s) => s.building.footprint);
  const origin = useEditorStore((s) => s.building.origin);
  const language = useEditorStore((s) => s.language);
  const setCameraView = useEditorStore((s) => s.setCameraView);
  const bearing = useCameraHeading((s) => s.bearing);
  const place = usePlaceName();

  const drawing = useMemo(() => {
    const points = footprint.map((p) => toEastNorth(origin, p));
    const centre = toEastNorth(origin, centroid(footprint));
    const xs = points.map((p) => p.east);
    const ys = points.map((p) => p.north);
    const span = Math.max(
      (Math.max(...xs) - Math.min(...xs)) / (WIDTH * FILL),
      (Math.max(...ys) - Math.min(...ys)) / (HEIGHT * FILL),
      MIN_SPAN_M / WIDTH,
    );
    // Metres to pixels, north up: y grows downward on screen.
    const px = (east: number, north: number) => ({
      x: WIDTH / 2 + (east - centre.east) / span,
      y: HEIGHT / 2 - (north - centre.north) / span,
    });
    const polygon = points.map((p) => px(p.east, p.north));
    const radius = (Math.hypot(WIDTH, HEIGHT) / 2) * span;
    const tiles = origin
      ? placeTiles(origin, TILE_ZOOM, radius).map((tile) => {
          const nw = toEastNorth(origin, tile.corners[0]);
          const se = toEastNorth(origin, tile.corners[2]);
          const a = px(nw.east, nw.north);
          const b = px(se.east, se.north);
          return { url: tile.url, x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
        })
      : [];
    return { polygon, tiles };
  }, [footprint, origin]);

  const point = compassPoint(bearing);
  const pointLabel = language === "de" ? point.replace(/E/g, "O") : point;

  return (
    <Card
      as="section"
      aria-label={t("minimap.title")}
      elevation="float"
      className="pointer-events-auto w-60 overflow-hidden"
    >
      <div className="relative bg-panel">
        <svg
          width="100%"
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          role="img"
          aria-label={t("minimap.footprint")}
          className="block"
        >
          {drawing.tiles.length > 0 ? (
            <g opacity={0.35} style={{ filter: "grayscale(1) contrast(0.9)" }}>
              {drawing.tiles.map((tile) => (
                <image
                  key={tile.url}
                  href={tile.url}
                  x={tile.x}
                  y={tile.y}
                  width={tile.width}
                  height={tile.height}
                  preserveAspectRatio="none"
                />
              ))}
            </g>
          ) : (
            <MinimapGrid />
          )}
          <polygon
            points={drawing.polygon.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            className="fill-footprint stroke-footprint-line"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
        <span className="absolute top-2 right-2">
          <CustomIconButton
            label={t("minimap.recentre")}
            size="sm"
            variant="floating"
            onClick={() => {
              setCameraView("3d");
            }}
          >
            <Navigation size={13} aria-hidden />
          </CustomIconButton>
        </span>
      </div>
      <footer className="flex h-8 items-center justify-between gap-2 border-t border-line px-3 font-num text-[11px]">
        <span className="text-muted" aria-label={t("minimap.heading")}>
          {pointLabel}
          <span className="ml-2">{Math.round(bearing)}°</span>
        </span>
        {place && <span className="min-w-0 truncate text-faint">{place}</span>}
      </footer>
    </Card>
  );
}

/** A faint metre grid for a building without a location. */
function MinimapGrid() {
  const lines = [];
  for (let x = 12; x < WIDTH; x += 24)
    lines.push(<line key={`x${String(x)}`} x1={x} x2={x} y1={0} y2={HEIGHT} />);
  for (let y = 12; y < HEIGHT; y += 24)
    lines.push(<line key={`y${String(y)}`} x1={0} x2={WIDTH} y1={y} y2={y} />);
  return (
    <g className="stroke-line" strokeWidth={1}>
      {lines}
    </g>
  );
}

/** The locality of the building from Photon, once per location. Null while unknown. */
function usePlaceName(): string | null {
  const footprint = useEditorStore((s) => s.building.footprint);
  const origin = useEditorStore((s) => s.building.origin);
  const [found, setFound] = useState<{ key: string; place: string | null } | null>(null);
  const centre = origin ? planToLatLon(centroid(footprint), origin) : null;
  // Rounded, so moving a wall does not ask the geocoder again.
  const key = centre ? `${centre.lat.toFixed(3)},${centre.lon.toFixed(3)}` : null;
  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",").map(Number) as [number, number];
    const controller = new AbortController();
    reverseAddress(lon, lat, controller.signal)
      .then((place) => {
        // "10965 Berlin" becomes "Berlin"; an empty locality shows nothing.
        const locality = place?.area.replace(/^\d+\s*/, "");
        setFound({ key, place: locality === "" || locality === undefined ? null : locality });
      })
      .catch(() => {
        // Without the geocoder the footer shows the heading only.
      });
    return () => {
      controller.abort();
    };
  }, [key]);
  return found?.key === key ? found.place : null;
}
