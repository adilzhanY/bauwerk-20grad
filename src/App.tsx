import { useSync } from "@/sync/useSync";
import { SaveBeforeLeaveDialog } from "@/components/app/SaveBeforeLeaveDialog";
import { useEffect, useState } from "react";
import { Shell } from "@/components/app/Shell";
import { useRouter } from "@/app/router";
import { useT } from "@/i18n/useT";
import { BuildingPage } from "@/pages/BuildingPage";
import { EditorPage } from "@/pages/EditorPage";
import { StartPage } from "@/pages/StartPage";
import { ProjectBar } from "@/components/app/ProjectBar";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ReportPage } from "@/pages/ReportPage";
import { VariantsPage } from "@/pages/VariantsPage";
import { LoginPage } from "@/pages/LoginPage";
import type { RenderSample } from "@/scene/FrameProbe";
import { useEditorStore } from "@/store/building";
import { BenchPage } from "@/pages/BenchPage";
import { PrintView } from "@/components/report/PrintView";
import { TooNarrow } from "@/components/app/States";

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
 * The app: the shell around one page. It starts on the Projects page; the map finds a
 * building; inside a project the building page, the editor, the variants and the report are
 * its four steps, with the step bar above them. The printable report and the bench page stay full screen.
 */
export function App() {
  const width = useWindowWidth();
  const route = useRouter((s) => s.route);
  const language = useEditorStore((s) => s.language);
  const buildingName = useEditorStore((s) => s.building.name);
  const projectGid = useEditorStore((s) => s.building.project?.gid);
  const inProject = useEditorStore((s) => s.building.project !== undefined);
  const t = useT();
  const [sample, setSample] = useState<RenderSample | null>(null);
  const sync = useSync();

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

  // The step bar shows inside a project; on a building page only for that project's building.
  const showBar =
    inProject &&
    (route.page === "building"
      ? route.gid === projectGid
      : route.page === "editor" || route.page === "variants" || route.page === "report");

  return (
    <Shell bar={showBar ? <ProjectBar /> : undefined}>
      <SaveBeforeLeaveDialog />
      {route.page === "projects" && <ProjectsPage />}
      {route.page === "map" && <StartPage />}
      {route.page === "building" && <BuildingPage key={route.gid} gid={route.gid} />}
      {route.page === "editor" && <EditorPage sync={sync} />}
      {route.page === "variants" && <VariantsPage />}
      {route.page === "report" && <ReportPage />}
      {route.page === "login" && <LoginPage />}
    </Shell>
  );
}
