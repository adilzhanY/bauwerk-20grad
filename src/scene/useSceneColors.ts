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
  mark: string;
  ink: string;
  muted: string;
}

function read(): SceneColors {
  return {
    bg: themeColor("--scene-bg", "#e9e9e3"),
    paper: themeColor("--paper", "#ffffff"),
    ground: themeColor("--scene-ground", "#dddcd4"),
    grid: themeColor("--scene-grid", "#c4c6bd"),
    gridStrong: themeColor("--scene-grid-strong", "#a9aba2"),
    select: themeColor("--select", "#234d8f"),
    mark: themeColor("--mark", "#c2431f"),
    ink: themeColor("--ink", "#1b1d20"),
    muted: themeColor("--muted", "#5b6068"),
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
