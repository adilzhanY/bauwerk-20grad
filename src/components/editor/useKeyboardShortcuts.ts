import { inTextField } from "@/lib/inTextField";
import { useEffect } from "react";
import { useEditorStore } from "@/store/building";
import type { Tool } from "@/store/building";

export const TOOL_ORDER: Tool[] = [
  "select",
  "footprint",
  "opening",
  "interiorWall",
  "zone",
  "measure",
  "hvac",
];

function ownsEditingShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const role = target.getAttribute("role");
  return ["slider", "combobox", "checkbox", "switch", "radio", "tab"].includes(role ?? "");
}

/**
 * Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, Delete removes the selection,
 * Escape clears it and returns to the select tool, 1 to 8 switch tools,
 * PageUp and PageDown switch storeys.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (inTextField(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (ownsEditingShortcut(e.target)) return;
        e.preventDefault();
        s.deleteSelection();
        return;
      }
      if (e.key === "Escape") {
        s.clearSelection();
        s.setMeasurement(null);
        if (s.tool !== "select") s.setTool("select");
        return;
      }
      const toolIndex = Number(e.key) - 1;
      const tool = TOOL_ORDER[toolIndex];
      if (!mod && e.key >= "1" && e.key <= "8" && tool) {
        if (ownsEditingShortcut(e.target)) return;
        s.setTool(tool);
        return;
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        const list = s.building.storeys;
        const index = list.findIndex((st) => st.id === s.activeStoreyId);
        const next = list[index + (e.key === "PageUp" ? 1 : -1)];
        if (next) s.setActiveStorey(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
