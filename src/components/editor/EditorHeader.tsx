import { SaveProjectButton } from "@/components/app/SaveProjectButton";
import { HeaderPortal } from "@/components/app/HeaderSlot";
import { CustomUndoRedo } from "@/components/shared/CustomUndoRedo";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import type { SyncStatus } from "@/sync/client";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { ShareButton } from "@/components/editor/ShareButton";

/**
 * The editor's part of the top bar. On the left the building name, its version (one per
 * recorded change), whether it is saved, and undo and redo. On the right who else is editing
 * Share and the Export menu. The building autosaves in the browser, or on the server when shared.
 */
export function EditorHeader({
  syncStatus,
  actor,
}: {
  syncStatus: SyncStatus | "local";
  actor: { actor: string; color: string } | null;
}) {
  const t = useT();
  const name = useEditorStore((s) => s.building.name);
  // Work without project facts has no project bar, so its Save lives here.
  const inProject = useEditorStore((s) => s.building.project !== undefined);
  const version = useEditorStore((s) => s.past.length + 1);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const presence = useEditorStore((s) => s.presence);
  const state =
    syncStatus === "local" || syncStatus === "online"
      ? t("editor.saved")
      : syncStatus === "connecting"
        ? t("editor.connecting")
        : t("editor.offline");

  return (
    <>
      <HeaderPortal slot="start">
        <h1 className="min-w-0 truncate text-base font-semibold text-ink">{name}</h1>
        <span className="shrink-0 font-num text-xs text-muted">
          v{version} · {state}
        </span>
        <CustomUndoRedo canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
      </HeaderPortal>
      <HeaderPortal slot="end">
        {actor && (
          <div
            className="mr-1 flex items-center -space-x-1.5"
            title={t("presence.title")}
            aria-label={t("presence.title")}
          >
            <PresenceDot color={actor.color} name={actor.actor} self />
            {presence.map((p) => (
              <PresenceDot key={p.clientId} color={p.color} name={p.actor} />
            ))}
          </div>
        )}
        {/* Work that is not a project yet has no project bar; Save sits here instead. */}
        {!inProject && <SaveProjectButton />}
        <ShareButton />
        <ExportMenu />
      </HeaderPortal>
    </>
  );
}

function PresenceDot({
  color,
  name,
  self = false,
}: {
  color: string;
  name: string;
  self?: boolean;
}) {
  return (
    <span
      title={name}
      className={
        self
          ? "h-7 w-7 rounded-full border-2 border-paper ring-2 ring-select"
          : "h-7 w-7 rounded-full border-2 border-paper"
      }
      style={{ background: color }}
    />
  );
}
