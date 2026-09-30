import { useT } from "@/i18n/useT";
import { Notice } from "@/components/shared/Notice";
import { Presence } from "@/components/shared/Presence";

/**
 * The banners under the editor's top bar: whether the photo's compass agrees with the
 * selected wall, and how much of the wall's base the detector could not see.
 */
export function EditorNotices({
  compassNote,
  baseHidden,
}: {
  compassNote: { text: string; warn: boolean } | null;
  baseHidden: number | null;
}) {
  const t = useT();
  return (
    <>
      <Presence value={compassNote}>
        {(note) => (
          <Notice tone={note.warn ? "warning" : "neutral"} className="mx-6 mb-3">
            {note.text}
          </Notice>
        )}
      </Presence>
      <Presence value={baseHidden}>
        {(hidden) => (
          <Notice tone="warning" className="mx-6 mb-3">
            {t("photo.baseHidden", { percent: Math.round(hidden * 100) })}
          </Notice>
        )}
      </Presence>
    </>
  );
}
