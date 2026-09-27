import { Redo2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/i18n/useT";

/**
 * Undo and redo as two quiet icon buttons, the shortcut in each tooltip. Shared by the
 * editor's top bar and the photo editor so both look and read the same.
 */
export function CustomUndoRedo({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center">
      <HistoryButton label={t("bar.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={16} aria-hidden />
      </HistoryButton>
      <HistoryButton
        label={t("bar.redo")}
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={16} aria-hidden />
      </HistoryButton>
    </span>
  );
}

function HistoryButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-keyshortcuts={shortcut.replace("Ctrl", "Control")}
      title={`${label} (${shortcut})`}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-panel hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
