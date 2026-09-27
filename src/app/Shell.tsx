import { useState } from "react";
import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { HeaderSlotContext } from "./headerSlotContext";

/**
 * The frame of every page: the white top bar, and the page filling everything below it edge
 * to edge. Pages put their own title and actions into the bar through `HeaderPortal`.
 */
export function Shell({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={{ start, end }}>
      <div className="flex h-full flex-col bg-ground">
        <AppHeader startSlot={setStart} endSlot={setEnd} />
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </HeaderSlotContext.Provider>
  );
}
