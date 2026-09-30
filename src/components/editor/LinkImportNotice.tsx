import type { LinkNotice } from "@/lib/linkImport";
import { useT } from "@/i18n/useT";
import { Toast } from "@/components/shared/Toast";

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
    <Toast
      tone={notice.ok ? "neutral" : "warning"}
      dismissLabel={t("linkImport.dismiss")}
      onDismiss={onDismiss}
    >
      {notice.ok ? t("linkImport.done", { name: notice.name }) : t("linkImport.failed")}
    </Toast>
  );
}
