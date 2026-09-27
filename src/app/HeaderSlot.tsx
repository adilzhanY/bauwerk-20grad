import { useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { HeaderSlotContext } from "./headerSlotContext";
import type { HeaderSlots } from "./headerSlotContext";

/**
 * Puts page content into the top bar. The editor uses it for the building name, the version
 * and the Export menu, which belong to the page but sit in the shell's bar.
 */
export function HeaderPortal({ slot, children }: { slot: keyof HeaderSlots; children: ReactNode }) {
  const target = useContext(HeaderSlotContext)[slot];
  return target ? createPortal(children, target) : null;
}
