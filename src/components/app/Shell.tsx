import { useState } from "react";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/AppHeader";
import { HeaderSlotContext } from "@/components/app/headerSlotContext";

/**
 * The frame of every page: the white top bar, a project's step bar when one is open, and the
 * page filling everything below edge to edge. Pages put their own title and actions into the bar through `HeaderPortal`.
 */
export function Shell({ children, bar }: { children: ReactNode; bar?: ReactNode }) {
  const [start, setStart] = useState<HTMLElement | null>(null);
  const [end, setEnd] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={{ start, end }}>
      <div className="flex h-full flex-col bg-ground">
        <AppHeader startSlot={setStart} endSlot={setEnd} />
        {bar}
        <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </HeaderSlotContext.Provider>
  );
}
