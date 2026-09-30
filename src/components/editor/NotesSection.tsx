import { Hint } from "@/components/shared/Hint";
import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { notesAbout } from "@/geometry/notes";
import type { NoteTarget } from "@/geometry/types";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { actorIdentity } from "@/sync/useSync";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomTextInput } from "@/components/shared/CustomTextInput";
import { cx } from "@/components/shared/cx";
import { useClock } from "@/components/editor/useClock";

/**
 * Notes on the selected element, or on the building when nothing is selected: what was seen
 * on site ("window 3 leaks"), who wrote it and when, and whether it is dealt with. Shared
 * with everyone in the project, like every other edit.
 */
export function NotesSection({ target }: { target: NoteTarget }) {
  const t = useT();
  const clock = useClock();
  const building = useEditorStore((s) => s.building);
  const projectId = useEditorStore((s) => s.projectId);
  const addNote = useEditorStore((s) => s.addNote);
  const setNoteDone = useEditorStore((s) => s.setNoteDone);
  const removeNote = useEditorStore((s) => s.removeNote);
  // A new key empties the field after a note is added.
  const [draftKey, setDraftKey] = useState(0);
  const notes = notesAbout(building, target);
  const author = projectId ? actorIdentity().actor : t("notes.me");

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-semibold text-ink">
        {t("notes.title")}
        {notes.length > 0 && <span className="font-normal text-muted"> · {notes.length}</span>}
      </span>
      {notes.map((note) => (
        <div
          key={note.id}
          className={cx(
            "flex items-start gap-2 rounded-inner border border-line bg-paper px-2.5 py-2",
            note.done && "opacity-60",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className={cx("text-sm text-ink", note.done && "line-through")}>{note.text}</p>
            <Hint>
              {note.author} · {clock(note.createdAt)}
            </Hint>
          </div>
          <CustomIconButton
            label={note.done ? t("notes.reopen") : t("notes.done")}
            size="sm"
            pressed={note.done === true}
            onClick={() => {
              setNoteDone(note.id, note.done !== true);
            }}
          >
            <Check size={14} aria-hidden />
          </CustomIconButton>
          <CustomIconButton
            label={t("notes.remove")}
            size="sm"
            onClick={() => {
              removeNote(note.id);
            }}
          >
            <Trash2 size={14} aria-hidden />
          </CustomIconButton>
        </div>
      ))}
      <CustomTextInput
        key={draftKey}
        label={t("notes.add")}
        value=""
        onCommit={(text) => {
          if (!text.trim()) return;
          addNote(target, text, author);
          setDraftKey((k) => k + 1);
        }}
      />
    </div>
  );
}
