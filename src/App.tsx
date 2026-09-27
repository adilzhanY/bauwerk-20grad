import { useEffect, useState } from "react";
import { Shell } from "@/app/Shell";
import { useRouter } from "@/app/router";
import { useT } from "@/i18n/useT";
import type { LinkNotice } from "@/lib/linkImport";
import { BuildingPage } from "@/pages/building/BuildingPage";
import { EditorPage } from "@/pages/EditorPage";
import { StartPage } from "@/pages/StartPage";
import type { RenderSample } from "@/scene/FrameProbe";
import { useEditorStore } from "@/store/building";
import { BenchPage } from "@/ui/BenchPage";
import { PrintView } from "@/ui/PrintView";
import { TooNarrow } from "@/ui/States";

const MIN_WIDTH = 1440;

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return width;
}

/**
 * The app: the shell with its navigation rail around one of three pages, start (search and
 * map), building and editor. The printable report and the bench page stay full screen.
 */
export function App({ linkNotice = null }: { linkNotice?: LinkNotice | null } = {}) {
  const width = useWindowWidth();
  const route = useRouter((s) => s.route);
  const language = useEditorStore((s) => s.language);
  const buildingName = useEditorStore((s) => s.building.name);
  const t = useT();
  const [sample, setSample] = useState<RenderSample | null>(null);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    document.title =
      route.page === "editor" ? `${buildingName} · ${t("app.title")}` : t("app.title");
  }, [buildingName, route.page, t]);

  if (new URLSearchParams(window.location.search).get("print") === "1") return <PrintView />;
  if (new URLSearchParams(window.location.search).get("bench") === "1")
    return <BenchPage sample={sample} onSample={setSample} />;
  if (width < MIN_WIDTH) return <TooNarrow />;

  return (
    <Shell>
      {route.page === "start" && <StartPage />}
      {route.page === "building" && <BuildingPage key={route.gid} gid={route.gid} />}
      {route.page === "editor" && <EditorPage linkNotice={linkNotice} />}
    </Shell>
  );
}
