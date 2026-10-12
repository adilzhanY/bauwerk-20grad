/**
 * API client. Every response is parsed through the schemas exported by lod2-core, so
 * a server/client drift surfaces here as a clear error rather than as an undefined
 * deep inside a render.
 */
import {
  BuildingDetailSchema,
  NeighboursSchema,
  SearchHitsSchema,
  type BuildingDetail,
  type Neighbour,
  type SearchHit,
} from "lod2-core/api";

const BASE = "/api";

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchBuilding(
  gid: string,
  signal?: AbortSignal,
): Promise<BuildingDetail | null> {
  const body = await getJson(`/buildings/${encodeURIComponent(gid)}`, signal);
  return body === null ? null : BuildingDetailSchema.parse(body);
}

/**
 * Buildings whose footprint touches a box of `boxM` metres centred on this one.
 *
 * Keyed on the building rather than a point, so the set does not shift when the map is
 * panned, and measured against footprints rather than centroids, so a long building
 * abutting the selection counts as adjacent.
 */
export async function fetchNeighbours(
  buildingGid: string,
  boxM = 800,
  signal?: AbortSignal,
): Promise<Neighbour[]> {
  const body = await getJson(
    `/buildings/${encodeURIComponent(buildingGid)}/neighbours?box=${boxM}`,
    signal,
  );
  return NeighboursSchema.parse(body ?? []);
}

export async function search(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const body = await getJson(`/search?q=${encodeURIComponent(q)}`, signal);
  return SearchHitsSchema.parse(body ?? []);
}

/**
 * Resolve a path the API handed us (e.g. an orthophoto URL) against the proxy prefix.
 *
 * The API emits paths relative to its own root because it has no idea how the browser
 * reaches it. Without this they resolve against the Vite dev server instead, which answers
 * with the SPA shell: a 200 that is not an image, so textures fail silently.
 */
export function apiUrl(path: string): string {
  return path.startsWith("http") ? path : `${BASE}${path}`;
}

export const tileUrl = `${BASE}/tiles/{z}/{x}/{y}.mvt`;
export const coverageUrl = `${BASE}/coverage/{z}/{x}/{y}.mvt`;
