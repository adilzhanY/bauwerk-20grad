import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ENERGY_CLASS_COLORS } from "@/geometry/energy";
import type { ProjectCard } from "@/projects/projects";
import { fallBackWhenStyleFails, LIGHT_STYLE } from "@/lib/mapStyle";

/** Berlin, for an office without located projects. */
const BERLIN: [number, number] = [13.405, 52.52];

/**
 * The projects as pins on the city, each in the colour of its energy class. A pin opens its
 * project; `selected` is ringed. Projects without a position (drawn by hand, not placed) are
 * only in the list beside the map.
 */
export function ProjectsMap({
  cards,
  selected,
  onSelect,
}: {
  cards: ProjectCard[];
  selected: string | null;
  onSelect: (card: ProjectCard) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ card: ProjectCard; marker: maplibregl.Marker }[]>([]);
  // The page passes a new function on every render; a pin calls the newest one.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  /** The projects the view was last fitted to: it moves only when that set changes. */
  const fitted = useRef("");

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: LIGHT_STYLE,
      center: BERLIN,
      zoom: 11,
      attributionControl: { compact: true },
    });
    fallBackWhenStyleFails(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const { marker } of markers.current) marker.remove();
    const placed = cards.filter((c) => c.summary.origin);
    markers.current = placed.map((card) => {
      const origin = card.summary.origin as { lon: number; lat: number };
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = card.summary.energyClass ?? "";
      pin.title = card.summary.title;
      pin.setAttribute("aria-label", card.summary.title);
      pin.className = "project-pin";
      pin.style.background = card.summary.energyClass
        ? ENERGY_CLASS_COLORS[card.summary.energyClass]
        : "var(--muted)";
      pin.addEventListener("click", () => {
        select.current(card);
      });
      const marker = new maplibregl.Marker({ element: pin, anchor: "bottom" })
        .setLngLat([origin.lon, origin.lat])
        .addTo(m);
      return { card, marker };
    });
    const key = placed.map((c) => `${c.ref.kind}:${c.ref.id}`).join(" ");
    if (placed.length > 0 && key !== fitted.current) {
      fitted.current = key;
      const bounds = new maplibregl.LngLatBounds();
      for (const c of placed) {
        const o = c.summary.origin as { lon: number; lat: number };
        bounds.extend([o.lon, o.lat]);
      }
      m.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 0 });
    }
  }, [cards]);

  useEffect(() => {
    for (const { card, marker } of markers.current) {
      const pin = marker.getElement();
      if (card.buildingId === selected) pin.dataset.selected = "true";
      else delete pin.dataset.selected;
    }
  }, [cards, selected]);

  return <div ref={box} className="h-full w-full" />;
}
