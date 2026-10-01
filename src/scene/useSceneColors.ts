import { useEffect, useState } from "react";
import { themeColor } from "@/lib/colors";
import { useEditorStore } from "@/store/building";

export interface SceneColors {
  bg: string;
  paper: string;
  ground: string;
  grid: string;
  gridStrong: string;
  select: string;
  /** A picked wall in the plan, against the ink of the other walls. */
  accent: string;
  mark: string;
  ink: string;
  muted: string;
  /** Outlines of the storeys and the roof drawn as outlines. */
  outline: string;
  /** Factor on the scene's lights: 1 in the light theme, less in the dark one. */
  light: number;
  /** Background and grid of the LoD2 building view. */
  siteBg: string;
  siteGrid: string;
  siteGridStrong: string;
  /** The AI colours (--ai-*), for the plan reveal after the AI placed walls. */
  ai1: string;
  ai2: string;
  aiInk: string;
}

function read(): SceneColors {
  return {
    bg: themeColor("--scene-bg", "#e9e9e3"),
    paper: themeColor("--paper", "#ffffff"),
    ground: themeColor("--scene-ground", "#dddcd4"),
    grid: themeColor("--scene-grid", "#c4c6bd"),
    gridStrong: themeColor("--scene-grid-strong", "#a9aba2"),
    select: themeColor("--select", "#234d8f"),
    accent: themeColor("--accent", "#1aa0ec"),
    mark: themeColor("--mark", "#c2431f"),
    ink: themeColor("--ink", "#1b1d20"),
    muted: themeColor("--muted", "#5b6068"),
    outline: themeColor("--scene-outline", "#97a4b1"),
    light: Number.parseFloat(themeColor("--scene-light", "1")) || 1,
    siteBg: themeColor("--site-bg", "#e9e9e3"),
    siteGrid: themeColor("--site-grid", "#c4c6bd"),
    siteGridStrong: themeColor("--site-grid-strong", "#a9aba2"),
    ai1: themeColor("--ai-1", "#7ea4e6"),
    ai2: themeColor("--ai-2", "#c084fc"),
    aiInk: themeColor("--ai-ink", "#a855f7"),
  };
}

/** Scene chrome colours read from the CSS tokens, refreshed when the theme changes. */
export function useSceneColors(): SceneColors {
  const theme = useEditorStore((s) => s.theme);
  const [colors, setColors] = useState(read);
  useEffect(() => {
    // The data-theme attribute is applied by the persistence layer in the same tick;
    // read after paint so the computed style is the new one.
    const id = requestAnimationFrame(() => {
      setColors(read());
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setColors(read());
    };
    media.addEventListener("change", onChange);
    return () => {
      cancelAnimationFrame(id);
      media.removeEventListener("change", onChange);
    };
  }, [theme]);
  return colors;
}
