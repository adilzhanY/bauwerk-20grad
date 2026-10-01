import { GitMerge } from "lucide-react";
import { useT } from "@/i18n/useT";
import type { Sync } from "@/sync/useSync";
import { CustomButton } from "@/components/shared/CustomButton";
import { Presence } from "@/components/shared/Presence";
import { Toast } from "@/components/shared/Toast";

/**
 * Two people on the same property within moments: the later one won, as always (TODO Part 21,
 * CH.2). The earlier one is told, and can put their value back as a new change of their own.
 */
export function OverwriteNotice({ sync }: { sync: Sync }) {
  const t = useT();
  return (
    <Presence value={sync.overwrite} kind="float">
      {(o) => (
        <Toast
          tone="warning"
          icon={<GitMerge size={16} aria-hidden />}
          actions={
            <>
              <CustomButton variant="primary" onClick={sync.keepMine}>
                {t("overwrite.keep")}
              </CustomButton>
              <CustomButton onClick={sync.dismissOverwrite}>{t("overwrite.theirs")}</CustomButton>
            </>
          }
        >
          {t("overwrite.body", { name: o.actor })}
        </Toast>
      )}
    </Presence>
  );
}
