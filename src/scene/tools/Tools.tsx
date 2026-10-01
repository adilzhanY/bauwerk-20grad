import { useEditorStore } from "@/store/building";
import { FootprintTool } from "./FootprintTool";
import { InteriorWallTool } from "./InteriorWallTool";
import { MeasureTool } from "./MeasureTool";
import { HvacTool } from "./HvacTool";

/** Mounts the scene-side part of the active tool. */
export function Tools() {
  const tool = useEditorStore((s) => s.tool);
  if (tool === "footprint") return <FootprintTool />;
  if (tool === "interiorWall") return <InteriorWallTool />;
  if (tool === "measure") return <MeasureTool />;
  if (tool === "hvac") return <HvacTool />;
  return null;
}
