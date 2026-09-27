import { useMemo, useState } from "react";
import { Viewport } from "@/scene/Viewport";
import { useEditorStore } from "@/store/building";
import { hasWebGL } from "@/lib/webgl";
import { useSync } from "@/sync/useSync";
import { LeftPanel } from "@/ui/LeftPanel";
import { RightPanel } from "@/ui/RightPanel";
import { EmptyState, WebGLMissing } from "@/ui/States";
import { EditorHeader } from "./editor/EditorHeader";
import { Minimap } from "./editor/Minimap";
import { StoreyPill } from "./editor/StoreyPill";
import { ToolDock } from "./editor/ToolDock";
import { ViewPill } from "./editor/ViewPill";
import { useKeyboardShortcuts } from "@/ui/useKeyboardShortcuts";
import { useT } from "@/i18n/useT";
import { LinkImportNotice } from "@/ui/LinkImportNotice";
import { SyncRejectNotice } from "@/ui/SyncRejectNotice";
import { VersionPreviewBanner } from "@/ui/VersionPreviewBanner";
import { WallPhotoEditor } from "@/ui/WallPhotoEditor";
import type { LinkNotice } from "@/lib/linkImport";

/** Widths of the side panels, px. */
const LEFT_PANEL = 300;
const RIGHT_PANEL = 400;

/**
 * The Bauwerk editor, laid out like the 20° app: the layers panel docked on the left, the
 * properties panel docked on the right, and between them the 3D view on its blue-grey ground
 * with the tool card and the storeys at the top left, the view switch at the top, and the
 * minimap at the bottom left. The building name, undo and Export sit in the top bar.
 */
export function EditorPage({ linkNotice = null }: { linkNotice?: LinkNotice | null } = {}) {
  useKeyboardShortcuts();
  const sync = useSync();
  const webgl = useMemo(() => hasWebGL(), []);
  const hasStoreys = useEditorStore((s) => s.building.storeys.length > 0);
  const tool = useEditorStore((s) => s.tool);
  const mapVisible = useEditorStore((s) => s.showMap && s.building.origin !== undefined);
  const t = useT();
  const [notice, setNotice] = useState<LinkNotice | null>(linkNotice);
  const [panelsOpen, setPanelsOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);

  return (
    <div className="flex h-full" data-tool={tool}>
      <WallPhotoEditor />
      <EditorHeader syncStatus={sync.status} actor={sync.status === "local" ? null : sync} />
      {panelsOpen && layersOpen && (
        <div className="shrink-0" style={{ width: LEFT_PANEL }}>
          <LeftPanel syncStatus={sync.status} />
        </div>
      )}
      <div className="scene-ground relative min-w-0 flex-1 overflow-hidden">
        <main aria-label={t("a11y.scene")} className="absolute inset-0">
          {!hasStoreys ? <EmptyState /> : webgl ? <Viewport /> : <WebGLMissing />}
        </main>
        {notice && (
          <LinkImportNotice
            notice={notice}
            onDismiss={() => {
              setNotice(null);
            }}
          />
        )}
        <VersionPreviewBanner />
        {sync.rejection && (
          <SyncRejectNotice rejection={sync.rejection} onDismiss={sync.dismissRejection} />
        )}
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
          {hasStoreys && (
            <div className="absolute bottom-4 left-4">
              <Minimap />
            </div>
          )}
          {mapVisible && hasStoreys && (
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="pointer-events-auto absolute right-4 bottom-2 rounded-soft bg-paper/85 px-2 py-0.5 text-xs text-muted hover:text-ink"
            >
              {t("map.attribution")}
            </a>
          )}
        </div>
      </div>
      {panelsOpen && (
        <div className="shrink-0" style={{ width: RIGHT_PANEL }}>
          <RightPanel />
        </div>
      )}
    </div>
  );
}
