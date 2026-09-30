import { History } from "lucide-react";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { Presence } from "@/components/shared/Presence";
import { Toast } from "@/components/shared/Toast";
import { endVersionPreview, restoreVersion } from "@/sync/useSync";
import { useClock } from "@/components/editor/useClock";

/** Says an old version is on screen, with the way to keep it or to go back to live. */
export function VersionPreviewBanner() {
  const t = useT();
  const clock = useClock();
  const preview = useEditorStore((s) => s.historyPreview);
  return (
    <Presence value={preview} kind="float">
      {(p) => (
        <Toast
          tone="info"
          icon={<History size={16} aria-hidden />}
          actions={
            <>
              <CustomButton variant="primary" onClick={restoreVersion}>
                {t("preview.restore")}
              </CustomButton>
              <CustomButton onClick={endVersionPreview}>{t("preview.back")}</CustomButton>
            </>
          }
        >
          {t("preview.banner", {
            version: p.version,
            time: clock(p.createdAt),
            actor: p.actor,
          })}
        </Toast>
      )}
    </Presence>
  );
}
