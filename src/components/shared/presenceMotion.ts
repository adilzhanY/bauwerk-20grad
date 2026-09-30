import { createContext, use } from "react";

/** True while the Presence around a floating element is playing its exit. */
export const Leaving = createContext(false);

/**
 * The class a floating element puts on its root: the site's float entrance, or its exit
 * while the Presence around it is leaving. Outside a Presence it still enters.
 */
export function useFloatMotion(): string {
  return use(Leaving) ? "motion-float-out" : "motion-float-in";
}

/** The same for a full-screen backdrop, which only fades. */
export function useFadeMotion(): string {
  return use(Leaving) ? "motion-fade-out" : "motion-fade-in";
}

/**
 * The same for a row in a list or tree that cannot take a wrapper (an li among li): it fades
 * and slides a few pixels, without touching the height.
 */
export function useRowMotion(): string {
  return use(Leaving) ? "motion-row-out" : "motion-row-in";
}
