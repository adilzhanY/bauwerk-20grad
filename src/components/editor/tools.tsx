import {
  DoorOpen,
  Layers,
  MousePointer2,
  PenTool,
  Ruler,
  RulerDimensionLine,
  Thermometer,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MessageKey } from "@/i18n";
import type { Tool } from "@/store/building";

export const toolIcons: Record<Tool, ReactNode> = {
  select: <MousePointer2 size={18} />,
  footprint: <PenTool size={18} />,
  opening: <DoorOpen size={18} />,
  interiorWall: <Ruler size={18} />,
  zone: <Layers size={18} />,
  measure: <RulerDimensionLine size={18} />,
  hvac: <Thermometer size={18} />,
};

export const toolLabel: Record<Tool, MessageKey> = {
  select: "tool.select",
  footprint: "tool.footprint",
  opening: "tool.opening",
  interiorWall: "tool.interiorWall",
  zone: "tool.zone",
  measure: "tool.measure",
  hvac: "tool.hvac",
};

export const toolHint: Record<Tool, MessageKey> = {
  select: "hint.select",
  footprint: "hint.footprint",
  opening: "hint.opening",
  interiorWall: "hint.interiorWall",
  zone: "hint.zone",
  measure: "hint.measure",
  hvac: "hint.hvac",
};
