import { useState } from "react";
import { X } from "lucide-react";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { Popover } from "@/components/shared/Popover";
import { useT } from "@/i18n/useT";
import { syncNote } from "@/auth/userData";

const KEY = "bauwerk.notes.";

function readNote(gid: string): string {
  try {
    return localStorage.getItem(KEY + gid) ?? "";
  } catch {
    return "";
  }
}

/**
 * Notes about a building, from the round button beside the main action. Kept in the browser,
 * and with the account when signed in.
 */
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
    syncNote(gid, value);
  };
  return (
    <Popover
      role="dialog"
      aria-label={t("building.notes")}
      className="absolute right-0 bottom-16 w-80"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{t("building.notes")}</span>
        <CustomIconButton label={t("common.close")} size="sm" onClick={onClose}>
          <X size={16} aria-hidden />
        </CustomIconButton>
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
    </Popover>
  );
}
