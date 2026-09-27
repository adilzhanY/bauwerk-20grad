import { X } from "lucide-react";
import type { LinkNotice } from "@/lib/linkImport";
import { useT } from "@/i18n/useT";
import { CustomIconButton } from "@/components/CustomIconButton";

/** Tells the user a building arrived through the link, or that the link was broken. */
export function LinkImportNotice({
  notice,
  onDismiss,
}: {
  notice: LinkNotice;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      role="status"
      className={`pointer-events-auto absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-control border px-4 py-1.5 text-sm shadow-float ${
        notice.ok ? "border-line bg-panel text-ink" : "border-mark bg-mark-soft text-mark"
      }`}
    >
      <span>
        {notice.ok ? t("linkImport.done", { name: notice.name }) : t("linkImport.failed")}
      </span>
      <CustomIconButton label={t("linkImport.dismiss")} size="sm" onClick={onDismiss}>
        <X size={14} aria-hidden />
      </CustomIconButton>
    </div>
  );
}
