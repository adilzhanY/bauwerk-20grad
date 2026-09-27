import { useT } from "@/i18n/useT";
import { cx } from "../../components/cx.ts";

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
      {compassNote && (
        <p
          className={cx(
            "mx-6 mb-3 shrink-0 rounded-inner px-4 py-2 text-xs",
            compassNote.warn ? "bg-mark-soft font-medium text-mark" : "bg-panel text-muted",
          )}
        >
          {compassNote.text}
        </p>
      )}
      {baseHidden !== null && (
        <p className="mx-6 mb-3 shrink-0 rounded-inner bg-mark-soft px-4 py-2 text-xs font-medium text-mark">
          {t("photo.baseHidden", { percent: Math.round(baseHidden * 100) })}
        </p>
      )}
    </>
  );
}
