import { useEffect } from "react";
import { useEditorStore } from "@/store/building";
import { PrintView } from "@/components/report/PrintView";

/**
 * A project's Report step: the printable report inside the app. The first visit marks the
 * report step as done on the project's card.
 */
export function ReportPage() {
  const hasProject = useEditorStore((s) => s.building.project !== undefined);
  const reported = useEditorStore((s) => s.building.project?.reportAt !== undefined);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);
  useEffect(() => {
    if (hasProject && !reported) setProjectInfo({ reportAt: new Date().toISOString() });
  }, [hasProject, reported, setProjectInfo]);
  return (
    <div className="h-full overflow-y-auto bg-white">
      <PrintView embedded />
    </div>
  );
}
