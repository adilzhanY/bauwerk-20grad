import { Floating } from "@/components/shared/Floating";
import { Presence } from "@/components/shared/Presence";
import { ToastStack } from "@/components/shared/Toast";
import { useMemo, useState } from "react";
import { Viewport } from "@/scene/Viewport";
import { useEditorStore } from "@/store/building";
import { hasWebGL } from "@/lib/webgl";
import type { Sync } from "@/sync/useSync";
import { LOCAL_SYNC, projectIdFromUrl } from "@/sync/useSync";
import { NoAccess } from "@/components/editor/NoAccess";
import { FollowFrame } from "@/components/editor/PeopleHere";
import { LeftPanel } from "@/components/editor/LeftPanel";
import { RightPanel } from "@/components/editor/RightPanel";
import { WebGLMissing } from "@/components/app/States";
import { EmptyState } from "@/components/editor/EmptyState";
import { EditorHeader } from "@/components/editor/EditorHeader";
import { Minimap } from "@/components/editor/Minimap";
import { StoreyPill } from "@/components/editor/StoreyPill";
import { ToolDock } from "@/components/editor/ToolDock";
import { ViewPill } from "@/components/editor/ViewPill";
import { useKeyboardShortcuts } from "@/components/editor/useKeyboardShortcuts";
import { useT } from "@/i18n/useT";
import { SyncRejectNotice } from "@/components/editor/SyncRejectNotice";
import { VersionPreviewBanner } from "@/components/editor/VersionPreviewBanner";
import { SinceLastVisit } from "@/components/editor/SinceLastVisit";
import { OverwriteNotice } from "@/components/editor/OverwriteNotice";
import { WallPhotoEditor } from "@/components/photo-editor/WallPhotoEditor";

/** Widths of the side panels, px. */
const LEFT_PANEL = 300;
const RIGHT_PANEL = 400;

/**
 * The Bauwerk editor, laid out like the 20° app: the layers panel docked on the left, the
 * properties panel docked on the right, and between them the 3D view on its blue-grey ground
 * with the tool card and the storeys at the top left, the view switch at the top, and the
 * minimap at the bottom left. The building name, undo and Export sit in the top bar.
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
  const mapVisible = useEditorStore((s) => s.showMap && s.building.origin !== undefined);
  const t = useT();
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);

  // Signed in, but not a member and without a share link: ask the owner instead.
  const blocked = sync.status === "noAccess" ? projectIdFromUrl() : null;
  if (blocked) return <NoAccess projectId={blocked} />;

  return (
    <div className="flex h-full" data-tool={tool}>
      <WallPhotoEditor />
      <EditorHeader syncStatus={sync.status} actor={sync.status === "local" ? null : sync} />
      <Presence show={panelsOpen && layersOpen} kind="float">
        <Floating fade className="shrink-0" style={{ width: LEFT_PANEL }}>
          <LeftPanel syncStatus={sync.status} />
        </Floating>
      </Presence>
      <div className="scene-ground relative min-w-0 flex-1 overflow-hidden">
        {/* Its own stacking context: the labels in the 3D view (drei Html, z-index in the millions)
            stay under the panels, the minimap and every dialog. */}
        <main aria-label={t("a11y.scene")} className="absolute inset-0 isolate">
          {!hasStoreys ? <EmptyState /> : webgl ? <Viewport /> : <WebGLMissing />}
        </main>
        <FollowFrame />
        {/* Under the view switch, which owns the top centre. */}
        <ToastStack offset="below-bar">
          <VersionPreviewBanner />
          <SinceLastVisit />
          <OverwriteNotice sync={sync} />
          <Presence value={sync.rejection} kind="float">
            {(r) => <SyncRejectNotice rejection={r} onDismiss={sync.dismissRejection} />}
          </Presence>
        </ToastStack>
        {/* A container, so the cards rearrange by the room the panels leave, not by the window. */}
        <div className="@container pointer-events-none absolute inset-0 p-4">
          <div className="absolute top-4 left-4 flex items-start gap-2">
            <ToolDock
              layersOpen={panelsOpen && layersOpen}
              onToggleLayers={() => {
                if (!panelsOpen) {
                  setPanelsOpen(true);
                  setLayersOpen(true);
                } else setLayersOpen(!layersOpen);
              }}
            />
            {hasStoreys && <StoreyPill />}
          </div>
          <div className="absolute top-4 right-4 @min-[44rem]:right-auto @min-[44rem]:left-1/2 @min-[44rem]:-translate-x-1/2">
            <ViewPill
              panelsOpen={panelsOpen}
              onTogglePanels={() => {
                setPanelsOpen(!panelsOpen);
              }}
            />
          </div>
          <Presence show={hasStoreys} kind="float">
            <Floating className="absolute bottom-4 left-4">
              <Minimap />
            </Floating>
          </Presence>
          <Presence show={mapVisible && hasStoreys} kind="float">
            <Floating className="absolute right-4 bottom-2">
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto rounded-soft bg-paper/85 px-2 py-0.5 text-xs text-muted hover:text-ink"
              >
                {t("map.attribution")}
              </a>
            </Floating>
          </Presence>
        </div>
      </div>
      <Presence show={panelsOpen} kind="float">
        <Floating fade className="shrink-0" style={{ width: RIGHT_PANEL }}>
          <RightPanel />
        </Floating>
      </Presence>
    </div>
  );
}
