import { Floating } from "@/components/shared/Floating";
import { Presence } from "@/components/shared/Presence";
import { ToastStack } from "@/components/shared/Toast";
import { useMemo, useState } from "react";
import { Viewport } from "@/scene/Viewport";
import { useEditorStore } from "@/store/building";
import { hasWebGL } from "@/lib/webgl";
import type { Sync } from "@/sync/useSync";
import { LOCAL_SYNC, projectIdFromUrl } from "@/sync/useSync";
import { Centered } from "@/components/shared/Centered";
import { Spinner } from "@/components/shared/Spinner";
import { NoAccess } from "@/components/editor/NoAccess";
import { FollowFrame } from "@/components/editor/PeopleHere";
import { LeftPanel } from "@/components/editor/LeftPanel";
import { RightPanel } from "@/components/editor/RightPanel";
import { HistoryDrawer } from "@/components/editor/HistoryDrawer";
import { WebGLMissing } from "@/components/app/States";
import { EmptyState } from "@/components/editor/EmptyState";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { Minimap } from "@/components/editor/Minimap";
import { StatusLine } from "@/components/editor/StatusLine";
import { StoreyPill } from "@/components/editor/StoreyPill";
import { ToolBar } from "@/components/editor/ToolBar";
import { ViewPill } from "@/components/editor/ViewPill";
import { useKeyboardShortcuts } from "@/components/editor/useKeyboardShortcuts";
import { useT } from "@/i18n/useT";
import { SyncRejectNotice } from "@/components/editor/SyncRejectNotice";
import { VersionPreviewBanner } from "@/components/editor/VersionPreviewBanner";
import { SinceLastVisit } from "@/components/editor/SinceLastVisit";
import { OverwriteNotice } from "@/components/editor/OverwriteNotice";
import { WallPhotoEditor } from "@/components/photo-editor/WallPhotoEditor";

/**
 * Widths of the side panels: narrower on a small window, so the 3D view keeps room for its
 * bars from the editor's minimum width of 1200 px up.
 */
const LEFT_PANEL = "clamp(264px, 22vw, 300px)";
const RIGHT_PANEL = "clamp(320px, 26vw, 400px)";

/**
 * The Bauwerk editor: the survey panel docked on the left, the properties panel on the right,
 * and between them the 3D view on its blue-grey ground. Over the view, top left, the tool bar
 * and under it the view switch, then the storeys; at the foot the minimap and the status line
 * with the tool's hint. The building name, undo, the history and Export sit in the top bar.
 */
export function EditorPage({
  sync = LOCAL_SYNC,
}: {
  /** The project's connection, kept by App on every page of the project. */
  sync?: Sync;
} = {}) {
  useKeyboardShortcuts();
  const webgl = useMemo(() => hasWebGL(), []);
  const hasStoreys = useEditorStore((s) => s.building.storeys.length > 0);
  const tool = useEditorStore((s) => s.tool);
  const t = useT();
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const openProjectId = useEditorStore((s) => s.projectId);
  // The empty building put up while a project loads carries no project facts; a building
  // just saved as a project does, and stays on screen while its first join completes.
  const placeholder = useEditorStore((s) => s.building.project === undefined);

  // Signed in, but not a member and without a share link: ask the owner instead.
  const blocked = sync.status === "noAccess" ? projectIdFromUrl() : null;
  if (blocked) return <NoAccess projectId={blocked} />;

  // The project in the address has not arrived yet: nothing to edit, so nothing editable is
  // shown (a placeholder building could take edits that belong nowhere).
  const wanted = projectIdFromUrl();
  if (wanted && openProjectId !== wanted && placeholder && sync.status !== "local") {
    return (
      <Centered
        title={t("editor.opening")}
        body={
          sync.status === "offline" || sync.status === "error" ? t("editor.openingOffline") : ""
        }
      >
        <Spinner size="md" />
      </Centered>
    );
  }

  return (
    <div className="relative flex h-full" data-tool={tool}>
      <WallPhotoEditor />
      <EditorHeader
        syncStatus={sync.status}
        actor={sync.status === "local" ? null : sync}
        historyOpen={historyOpen}
        onToggleHistory={() => {
          setHistoryOpen(!historyOpen);
        }}
      />
      <Presence show={panelsOpen && layersOpen} kind="float">
        <Floating fade className="shrink-0" style={{ width: LEFT_PANEL }}>
          <LeftPanel />
        </Floating>
      </Presence>
      <div className="scene-ground relative min-w-0 flex-1 overflow-hidden">
        {/* Its own stacking context: the labels in the 3D view (drei Html, z-index in the millions)
            stay under the panels, the minimap and every dialog. */}
        <main aria-label={t("a11y.scene")} className="absolute inset-0 isolate">
          {!hasStoreys ? <EmptyState /> : webgl ? <Viewport /> : <WebGLMissing />}
        </main>
        <FollowFrame />
        {/* Under the two bars, which own the top left. */}
        <ToastStack offset="below-bar">
          <VersionPreviewBanner />
          <SinceLastVisit />
          <OverwriteNotice sync={sync} />
          <Presence value={sync.rejection} kind="float">
            {(r) => <SyncRejectNotice rejection={r} onDismiss={sync.dismissRejection} />}
          </Presence>
        </ToastStack>
        {/* A container, so the bars rearrange by the room the panels leave, not by the window. */}
        <div className="@container pointer-events-none absolute inset-0 p-4">
          <div className="absolute top-4 right-4 left-4 flex flex-col items-start gap-2">
            <ToolBar
              layersOpen={panelsOpen && layersOpen}
              onToggleLayers={() => {
                if (!panelsOpen) {
                  setPanelsOpen(true);
                  setLayersOpen(true);
                } else setLayersOpen(!layersOpen);
              }}
            />
            <ViewPill
              panelsOpen={panelsOpen}
              onTogglePanels={() => {
                setPanelsOpen(!panelsOpen);
              }}
            />
            {hasStoreys && <StoreyPill />}
          </div>
          <Presence show={hasStoreys} kind="float">
            <Floating className="absolute bottom-4 left-4">
              <Minimap />
            </Floating>
          </Presence>
          {/* Beside the minimap, the width of the view that is left. */}
          <div className="absolute right-4 bottom-4 left-[16.5rem] flex justify-end">
            <StatusLine />
          </div>
        </div>
      </div>
      <Presence show={panelsOpen} kind="float">
        <Floating fade className="shrink-0" style={{ width: RIGHT_PANEL }}>
          <RightPanel />
        </Floating>
      </Presence>
      {/* Over the properties panel, where the old versions are read beside the model. */}
      <Presence show={historyOpen} kind="float">
        <Floating className="absolute top-0 right-0 bottom-0 z-30" style={{ width: RIGHT_PANEL }}>
          <HistoryDrawer
            onClose={() => {
              setHistoryOpen(false);
            }}
          />
        </Floating>
      </Presence>
    </div>
  );
}
