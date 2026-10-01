import { DoorOpen, MousePointer2, RulerDimensionLine } from "lucide-react";
import type { ReactNode } from "react";
import { Footprint, InteriorWall, Radiator, WindowFrame, Zone } from "@/components/shared/icons";
import type { MessageKey } from "@/i18n";
import type { Tool } from "@/store/building";

/** The survey tools, each one click in the tool bar, in the order of their keys 1 to 5. */
export const MAIN_TOOLS: readonly Tool[] = ["select", "interiorWall", "window", "door", "measure"];

/** The rarer tools behind "More", keys 6 to 8. */
export const MORE_TOOLS: readonly Tool[] = ["footprint", "zone", "hvac"];

/** Every tool in the order of its number key. */
export const TOOL_ORDER: readonly Tool[] = [...MAIN_TOOLS, ...MORE_TOOLS];

/** The number key of a tool, "1" to "8". */
export const toolKey = (tool: Tool): string => String(TOOL_ORDER.indexOf(tool) + 1);

export const toolIcons: Record<Tool, ReactNode> = {
  select: <MousePointer2 size={18} />,
  interiorWall: <InteriorWall size={18} />,
  window: <WindowFrame size={18} />,
  door: <DoorOpen size={18} />,
  measure: <RulerDimensionLine size={18} />,
  footprint: <Footprint size={18} />,
  zone: <Zone size={18} />,
  hvac: <Radiator size={18} />,
};

export const toolLabel: Record<Tool, MessageKey> = {
  select: "tool.select",
  interiorWall: "tool.interiorWall",
  window: "tool.window",
  door: "tool.door",
  measure: "tool.measure",
  footprint: "tool.footprint",
  zone: "tool.zone",
  hvac: "tool.hvac",
};

export const toolHint: Record<Tool, MessageKey> = {
  select: "hint.select",
  interiorWall: "hint.interiorWall",
  window: "hint.window",
  door: "hint.door",
  measure: "hint.measure",
  footprint: "hint.footprint",
  zone: "hint.zone",
  hvac: "hint.hvac",
};
