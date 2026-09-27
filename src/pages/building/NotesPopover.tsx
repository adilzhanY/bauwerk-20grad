import { useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/useT";

const KEY = "bauwerk.notes.";

function readNote(gid: string): string {
  try {
    return localStorage.getItem(KEY + gid) ?? "";
  } catch {
    return "";
  }
}

/** Notes about a building, from the round button beside the main action. Kept in the browser. */
export function NotesPopover({ gid, onClose }: { gid: string; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(() => readNote(gid));
  const save = (value: string) => {
    setText(value);
    try {
      localStorage.setItem(KEY + gid, value);
    } catch {
      // Blocked storage keeps the note for this page only.
    }
  };
  return (
    <div
      role="dialog"
      aria-label={t("building.notes")}
      className="absolute right-0 bottom-16 w-80 rounded-card border border-line bg-paper p-4 shadow-float"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{t("building.notes")}</span>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="text-muted hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <textarea
        value={text}
        autoFocus
        placeholder={t("building.notesPlaceholder")}
        onChange={(e) => {
          save(e.target.value);
        }}
        className="h-36 w-full resize-none rounded-inner border border-line bg-panel p-3 text-sm outline-none focus:border-select"
      />
    </div>
  );
}
