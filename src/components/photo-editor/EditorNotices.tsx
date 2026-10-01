import { useT } from "@/i18n/useT";
import { Notice } from "@/components/shared/Notice";
import { Presence } from "@/components/shared/Presence";
import { aiOffText } from "@/lib/aiHost";

/**
 * The banners under the editor's top bar: that the AI cannot be reached (the corners and the
 * openings are then set by hand), whether the photo's compass agrees with the selected wall,
 * and how much of the wall's base the detector could not see.
 */
export function EditorNotices({
  aiOff,
  compassNote,
  baseHidden,
}: {
  aiOff: boolean;
  compassNote: { text: string; warn: boolean } | null;
  baseHidden: number | null;
}) {
  const t = useT();
  return (
    <>
      <Presence show={aiOff}>
        <Notice tone="neutral" className="mx-6 mb-3">
          {aiOffText(t)} {t("photo.byHandMeanwhile")}
        </Notice>
      </Presence>
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
