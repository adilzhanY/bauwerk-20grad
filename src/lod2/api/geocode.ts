/**
 * Addresses for a city whose building data has none. Berlin's LoD2 carries no addresses, so
 * the search goes through Photon (photon.komoot.io), an OpenStreetMap geocoder that needs no
 * key, and the API then finds the building at the point it returns.
 */
import { z } from "zod";
import { apiUrl } from "./client";

/** Only Berlin is wired up; searching elsewhere would find places without buildings. */
const BERLIN_BBOX = "13.08,52.33,13.77,52.68";
const PHOTON = "https://photon.komoot.io";

const FeatureSchema = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
  }),
});
const ResultSchema = z.object({ features: z.array(FeatureSchema) });

export interface Place {
  /** The bold part: street and number, or the place's name. */
  main: string;
  /** The grey part: post code and city. */
  area: string;
  lon: number;
  lat: number;
}

function toPlace(feature: z.infer<typeof FeatureSchema>): Place {
  const p = feature.properties;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "";
  const main = street || (p.name ?? "");
  const area = [p.postcode, p.city ?? p.district].filter(Boolean).join(" ");
  const [lon, lat] = feature.geometry.coordinates;
  return { main, area, lon, lat };
}

/** Up to six places in Berlin for a typed address, without duplicates. */
export async function searchAddress(query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&lang=de&limit=8&bbox=${BERLIN_BBOX}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${String(res.status)}`);
  const places = ResultSchema.parse(await res.json())
    .features.map(toPlace)
    .filter((p) => p.main);
  const seen = new Set<string>();
  return places
    .filter((p) => {
      const key = `${p.main}|${p.area}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

/** The address at a point, for a building page title. Null when Photon knows none. */
export async function reverseAddress(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<Place | null> {
  const res = await fetch(`${PHOTON}/reverse?lon=${String(lon)}&lat=${String(lat)}&lang=de`, {
    signal,
  });
  if (!res.ok) return null;
  const feature = ResultSchema.parse(await res.json()).features[0];
  return feature ? toPlace(feature) : null;
}

/** The loaded building nearest to a point, or null when none is loaded there yet. */
export async function buildingAtPoint(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const res = await fetch(apiUrl(`/building-at?lon=${String(lon)}&lat=${String(lat)}`), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${String(res.status)}`);
  const body = z.object({ buildingGid: z.string() }).parse(await res.json());
  return body.buildingGid;
}
