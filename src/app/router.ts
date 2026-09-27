import { create } from "zustand";

/**
 * The app's three pages and their paths. A few lines instead of a router library: the app
 * has three routes and one parameter.
 *
 *   /                  start page: search and map
 *   /gebaeude/<gid>    building page: energy data, facade survey, 3D model
 *   /editor            the Bauwerk editor
 *
 * Paths sit under the app's base path (Vite's BASE_URL, "/" locally, "/bauwerk/" on Pages).
 * Query parameters such as `?at=` (the map view) and `?print=1` pass through untouched.
 */
export type Route = { page: "start" } | { page: "building"; gid: string } | { page: "editor" };

const BUILDING = "gebaeude";
const EDITOR = "editor";

/** The route for a path below the base path. Unknown paths open the start page. */
export function parseRoute(pathname: string, base = "/"): Route {
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname.replace(/^\//, "");
  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === BUILDING && parts[1])
    return { page: "building", gid: decodeURIComponent(parts[1]) };
  if (parts[0] === EDITOR) return { page: "editor" };
  return { page: "start" };
}

/** The path of a route, below the base path. */
export function routePath(route: Route, base = "/"): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (route.page === "building") return `${prefix}${BUILDING}/${encodeURIComponent(route.gid)}`;
  if (route.page === "editor") return `${prefix}${EDITOR}`;
  return prefix;
}

const BASE = import.meta.env.BASE_URL;

interface RouterState {
  route: Route;
  /** Go to a route; the query string stays unless `query` replaces it. */
  navigate: (route: Route, options?: { replace?: boolean; query?: string }) => void;
}

export const useRouter = create<RouterState>((set) => ({
  route: parseRoute(window.location.pathname, BASE),
  navigate: (route, options = {}) => {
    const query = options.query ?? window.location.search;
    const url = routePath(route, BASE) + query;
    if (options.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    set({ route });
  },
}));

window.addEventListener("popstate", () => {
  useRouter.setState({ route: parseRoute(window.location.pathname, BASE) });
});
