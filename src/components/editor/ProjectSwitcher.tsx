import { Cloud, CloudOff } from "lucide-react";
import { useT } from "@/i18n/useT";
import type { SyncStatus } from "@/sync/client";
import { syncEnabled } from "@/sync/useSync";
import { CustomSection } from "@/components/shared/CustomField";

/**
 * Whether the open project is connected to the server. Opening, creating and saving projects
 * happen on the Projects page and with Save in the project bar, so there is one way to do
 * each. Only rendered when the client is built with a server URL.
 */
export function ProjectSwitcher({ status }: { status: SyncStatus | "local" }) {
  const t = useT();
  if (!syncEnabled) return null;
  return (
    <CustomSection title={t("project.title")}>
      <div className="flex items-center gap-2 text-xs text-muted">
        {status === "online" ? (
          <Cloud size={14} className="text-ok" />
        ) : (
          <CloudOff size={14} className="text-mark" />
        )}
        {t(`project.status.${status}`)}
      </div>
    </CustomSection>
  );
}
