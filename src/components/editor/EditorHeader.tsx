import { History } from "lucide-react";
import { Floating } from "@/components/shared/Floating";
import { Presence } from "@/components/shared/Presence";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { SaveProjectButton } from "@/components/shared/SaveProjectButton";
import { HeaderPortal } from "@/components/shared/HeaderSlot";
import { CustomUndoRedo } from "@/components/shared/CustomUndoRedo";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import type { SyncStatus } from "@/sync/client";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { ShareButton } from "@/components/editor/ShareButton";
import { PeopleHere } from "@/components/editor/PeopleHere";

/**
 * The editor's part of the top bar. On the left the building name, the connection only while
 * it is not live (Save says whether the work is saved, the history lists the versions), and
 * undo and redo. On the right who else is editing,
 * the history (a clock that opens the history drawer), Share and the Export menu. The building autosaves in the browser, or on the server when shared.
 */
export function EditorHeader({
  syncStatus,
  actor,
  historyOpen = false,
  onToggleHistory,
}: {
  syncStatus: SyncStatus | "local";
  actor: { actor: string; color: string } | null;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
}) {
  const t = useT();
  const name = useEditorStore((s) => s.building.name);
  // Work without project facts has no project bar, so its Save lives here.
  const inProject = useEditorStore((s) => s.building.project !== undefined);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const role = useEditorStore((s) => s.projectRole);
  // One status: saved or not is the Save button's; here only a connection that is not live.
  const state =
    syncStatus === "connecting"
      ? t("editor.connecting")
      : syncStatus === "offline" || syncStatus === "error"
        ? t("editor.offline")
        : null;

  return (
    <>
      <HeaderPortal slot="start">
        <h1 className="min-w-0 truncate text-base font-semibold text-ink">{name}</h1>
        <Presence value={state} kind="float">
          {(text) => (
            <Floating fade className="shrink-0 font-num text-xs text-muted">
              {text}
            </Floating>
          )}
        </Presence>
        {role === "viewer" || role === "commenter" ? (
          // Viewers and commenters change nothing (store/history.ts): say so instead of undo.
          <span className="shrink-0 rounded-full bg-select-soft px-2.5 py-0.5 text-xs font-medium text-select">
            {t(`role.badge.${role}`)}
          </span>
        ) : (
          <CustomUndoRedo canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
        )}
      </HeaderPortal>
      <HeaderPortal slot="end">
        {actor && <PeopleHere />}
        {/* Work that is not a project yet has no project bar; Save sits here instead. */}
        {!inProject && <SaveProjectButton />}
        {onToggleHistory && (
          <CustomIconButton
            label={t("history.title")}
            pressed={historyOpen}
            onClick={onToggleHistory}
          >
            <History size={17} aria-hidden />
          </CustomIconButton>
        )}
        <ShareButton />
        <ExportMenu />
      </HeaderPortal>
    </>
  );
}
