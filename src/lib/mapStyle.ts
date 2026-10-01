import type maplibregl from "maplibre-gl";

/** basemap.de vector tiles, BKG: German official open data, no key. The grey style, as in the 20° app. */
export const LIGHT_STYLE =
  "https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json";
/**
 * What the map shows when basemap.de does not answer: OpenStreetMap in grey. Without it an
 * outage there would hide the LoD2 buildings too, since they are added once a style loads.
 */
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -1 } }],
};
/** How long basemap.de gets before the map falls back to OpenStreetMap. */
const STYLE_TIMEOUT_MS = 4000;

/** Switches `m` to the fallback style when its style fails or takes too long to arrive. */
export function fallBackWhenStyleFails(m: maplibregl.Map): void {
  let settled = false;
  const fallBack = () => {
    if (settled || m.isStyleLoaded()) return;
    settled = true;
    m.setStyle(FALLBACK_STYLE);
  };
  const timer = setTimeout(fallBack, STYLE_TIMEOUT_MS);
  m.on("style.load", () => {
    settled = true;
    clearTimeout(timer);
  });
  m.on("error", fallBack);
  m.on("remove", () => {
    clearTimeout(timer);
  });
}
