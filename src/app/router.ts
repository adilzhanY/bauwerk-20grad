import { create } from "zustand";

/**
 * The app's pages and their paths. A few lines instead of a router library: a handful of
 * routes and one parameter.
 *
 *   /                  the Projects page, where the app starts
 *   /karte             the map: find a building by address or by clicking it
 *   /gebaeude/<gid>    building page, a project's Survey step: LoD2 data, facade photos
 *   /editor            the Bauwerk editor, a project's Model step
 *   /varianten         renovation variants and the energy balance, the Variants step
 *   /bericht           the printable report, the Report step
 *   /login             sign in or create an account (with accounts on)
 *
 * Paths sit under the app's base path (Vite's BASE_URL, "/" locally, "/bauwerk/" on Pages).
 * Query parameters such as `?at=` (the map view) and `?print=1` pass through untouched.
 */
export type Route =
  | { page: "projects" }
  | { page: "map" }
  | { page: "building"; gid: string }
  | { page: "editor" }
  | { page: "variants" }
  | { page: "report" }
  | { page: "login" };

const BUILDING = "gebaeude";
/** Single-segment pages and their path. */
const PAGES = {
  map: "karte",
  editor: "editor",
  variants: "varianten",
  report: "bericht",
  login: "login",
} as const;

/** The route for a path below the base path. Unknown paths open the Projects page. */
export function parseRoute(pathname: string, base = "/"): Route {
  const rest = pathname.startsWith(base)
    ? pathname.slice(base.length)
    : pathname.replace(/^\//, "");
  const parts = rest.split("/").filter(Boolean);
  if (parts[0] === BUILDING && parts[1])
    return { page: "building", gid: decodeURIComponent(parts[1]) };
  for (const [page, path] of Object.entries(PAGES)) {
    if (parts[0] === path) return { page } as Route;
  }
  return { page: "projects" };
}

/** The path of a route, below the base path. */
export function routePath(route: Route, base = "/"): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (route.page === "building") return `${prefix}${BUILDING}/${encodeURIComponent(route.gid)}`;
  if (route.page === "projects") return prefix;
  return `${prefix}${PAGES[route.page]}`;
}

const BASE = import.meta.env.BASE_URL;

interface RouterState {
  route: Route;
  /** Go to a route; the query string stays unless `query` replaces it. */
  navigate: (route: Route, options?: { replace?: boolean; query?: string }) => void;
}

/**
 * Asked before every navigation: true to go on, false to stay, or a promise of either, for
 * a question to the user first (unsaved work, projects/session.ts).
 */
export type LeaveGuard = (from: Route, to: Route) => boolean | Promise<boolean>;
let leaveGuard: LeaveGuard | null = null;

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard;
}

export const useRouter = create<RouterState>((set, get) => ({
  route: parseRoute(window.location.pathname, BASE),
  navigate: (route, options = {}) => {
    const go = () => {
      const query = options.query ?? window.location.search;
      const url = routePath(route, BASE) + query;
      if (options.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      set({ route });
    };
    const allowed = leaveGuard ? leaveGuard(get().route, route) : true;
    if (allowed === true) go();
    else if (allowed !== false)
      void allowed.then((ok) => {
        if (ok) go();
      });
  },
}));

window.addEventListener("popstate", () => {
  useRouter.setState({ route: parseRoute(window.location.pathname, BASE) });
});

/**
 * Where to go after signing in, from `?next=`: only a path on this site. Anything else (an
 * absolute URL, `//other.site`, a backslash trick) falls back to the editor, so the login
 * page cannot be used to send people elsewhere.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return routePath({ page: "editor" }, BASE);
  }
  return next;
}

/** The login page, coming back to where the user is now. */
export function loginPath(): string {
  const here = window.location.pathname + window.location.search;
  return `${routePath({ page: "login" }, BASE)}?next=${encodeURIComponent(here)}`;
}
