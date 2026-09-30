import { createContext } from "react";

/** The two places in the top bar a page can fill: after the navigation, and before the user. */
export interface HeaderSlots {
  start: HTMLElement | null;
  end: HTMLElement | null;
}

export const HeaderSlotContext = createContext<HeaderSlots>({ start: null, end: null });
