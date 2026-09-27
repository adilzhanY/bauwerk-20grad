import { History } from "lucide-react";
import { useT } from "@/i18n/useT";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/CustomButton";
import { endVersionPreview, restoreVersion } from "@/sync/useSync";
import { useClock } from "./useClock";

/** Says an old version is on screen, with the way to keep it or to go back to live. */
export function VersionPreviewBanner() {
  const t = useT();
  const clock = useClock();
  const preview = useEditorStore((s) => s.historyPreview);
  if (!preview) return null;
  return (
    <div
      role="status"
      className="pointer-events-auto absolute top-16 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-control border border-select bg-paper px-4 py-2 text-sm text-ink shadow-float"
    >
      <History size={16} aria-hidden className="shrink-0 text-select" />
      <span>
        {t("preview.banner", {
          version: preview.version,
          time: clock(preview.createdAt),
          actor: preview.actor,
        })}
      </span>
      <CustomButton variant="primary" onClick={restoreVersion}>
        {t("preview.restore")}
      </CustomButton>
      <CustomButton onClick={endVersionPreview}>{t("preview.back")}</CustomButton>
    </div>
  );
}
