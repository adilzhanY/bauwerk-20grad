import { useState } from "react";
import { Check, Save } from "lucide-react";
import { CustomButton } from "@/components/shared/CustomButton";
import { useT } from "@/i18n/useT";
import { isUnsaved, saveProject } from "@/projects/session";
import { useEditorStore } from "@/store/building";

/**
 * Save for the open work. Until the first Save it is the navy button; after it the project
 * keeps itself (live on the server, as it changes in this browser), and this shows that it
 * is saved. Ctrl+S does the same (projects/session.ts).
 */
export function SaveProjectButton() {
  const t = useT();
  // Subscribed to what isUnsaved reads, so the button follows edits and the save.
  const unsaved = useEditorStore((s) => isUnsaved(s));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!unsaved) {
    return (
      <span className="flex h-9 items-center gap-1.5 px-2 text-sm text-muted" role="status">
        <Check size={15} aria-hidden className="text-ok" />
        {t("project.saved")}
      </span>
    );
  }
  return (
    <CustomButton
      variant="primary"
      icon={<Save size={15} aria-hidden />}
      loading={busy}
      title={t("project.saveShortcut")}
      onClick={() => {
        setBusy(true);
        setFailed(false);
        void saveProject().then((ok) => {
          setBusy(false);
          setFailed(!ok);
        });
      }}
    >
      {failed ? t("project.saveFailed") : t("project.save")}
    </CustomButton>
  );
}
