import { useEffect, useState } from "react";
import { useT } from "@/i18n/useT";
import type { MessageKey } from "@/i18n";
import { useEditorStore } from "@/store/building";
import { cx } from "@/components/shared/cx";
import { groupVersions } from "@/sync/history";
import type { VersionGroup } from "@/sync/history";
import { endVersionPreview, fetchVersion, fetchVersions, showVersion } from "@/sync/useSync";
import { useClock } from "@/components/editor/useClock";

/**
 * The versions of the shared project, newest first, one line per person and minute. A click
 * shows that version read only; the first line goes back to the live building.
 */
export function HistoryPanel() {
  const t = useT();
  const clock = useClock();
  const projectId = useEditorStore((s) => s.projectId);
  const building = useEditorStore((s) => s.building);
  const preview = useEditorStore((s) => s.historyPreview);
  const [groups, setGroups] = useState<VersionGroup[]>([]);
  const [failed, setFailed] = useState<number | null>(null);

  // Every change makes a version, so the list follows the building, a moment later.
  useEffect(() => {
    if (!projectId || preview) return;
    const timer = setTimeout(() => {
      void fetchVersions().then((entries) => {
        setGroups(groupVersions(entries));
      });
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [projectId, building, preview]);

  if (!projectId) return <p className="text-sm text-muted">{t("history.local")}</p>;
  if (groups.length === 0) return <p className="text-sm text-muted">{t("history.empty")}</p>;

  const open = async (group: VersionGroup) => {
    setFailed(null);
    const old = await fetchVersion(group.version);
    if (!old) {
      setFailed(group.version);
      return;
    }
    showVersion(old, { version: group.version, actor: group.actor, createdAt: group.createdAt });
  };

  const live = groups[0]?.version;
  return (
    <ol className="flex flex-col gap-0.5" aria-label={t("history.title")}>
      {groups.map((group) => {
        const current = preview ? preview.version === group.version : group.version === live;
        const what: string = group.created
          ? t("history.created")
          : group.changes === 1
            ? t("history.change")
            : t("history.changes", { count: group.changes });
        const label: MessageKey = group.version === live ? "history.live" : "history.version";
        return (
          <li key={group.version}>
            <button
              type="button"
              aria-current={current ? "true" : undefined}
              onClick={() => {
                if (group.version === live) endVersionPreview();
                else void open(group);
              }}
              className={cx(
                "flex w-full flex-col items-start rounded-control px-2.5 py-2 text-left transition-colors hover:bg-panel",
                current && "bg-select-soft hover:bg-select-soft",
              )}
            >
              <span className="flex w-full items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{group.actor}</span>
                <span className="shrink-0 font-num text-xs text-muted">
                  {clock(group.createdAt)}
                </span>
              </span>
              <span className="text-xs text-muted">
                {t(label, { version: group.version })} · {what}
              </span>
              {failed === group.version && (
                <span className="text-xs text-mark">{t("history.unavailable")}</span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
