import { useEffect, useState } from "react";
import { FileDown, GitCompare, Pencil, Star, X } from "lucide-react";
import { authHeaders } from "@/auth/api";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import { buildingFileName, downloadFile } from "@/lib/download";
import { deleteNamed, listNamed, nameVersion, renameNamed } from "@/projects/collab";
import type { NamedVersion } from "@/projects/collab";
import { can } from "@/projects/roles";
import { syncConfigFromEnv } from "@/sync/client";
import { groupSessions } from "@/sync/history";
import type { Session } from "@/sync/history";
import { endVersionPreview, fetchVersion, fetchVersions, showVersion } from "@/sync/useSync";
import { useEditorStore } from "@/store/building";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomFormInput } from "@/components/shared/CustomFormInput";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { cx } from "@/components/shared/cx";
import { Hint } from "@/components/shared/Hint";
import { SectionLabel } from "@/components/shared/PageTitle";
import { Presence } from "@/components/shared/Presence";
import { changeText } from "./changeText";
import { CompareDialog } from "./CompareDialog";
import { useClock } from "./useClock";

/**
 * The history of the shared project (TODO Part 21, CG): named versions first (milestones to
 * show, compare and print), then the work sessions, one line per person's uninterrupted work
 * with what it did. A click shows that version read only; the first session is the live
 * building. Restoring stays one ordinary change, which undo takes back.
 */
export function HistoryPanel() {
  const t = useT();
  const clock = useClock();
  const projectId = useEditorStore((s) => s.projectId);
  const building = useEditorStore((s) => s.building);
  const preview = useEditorStore((s) => s.historyPreview);
  const role = useEditorStore((s) => s.projectRole);
  const language = useEditorStore((s) => s.language);
  const editor = role === null || can(role, "edit");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [named, setNamed] = useState<NamedVersion[]>([]);
  const [failed, setFailed] = useState<number | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [comparing, setComparing] = useState<{ version: number; name: string } | null>(null);
  const [round, setRound] = useState(0);
  const [reportFailed, setReportFailed] = useState(false);
  const [listFailed, setListFailed] = useState(false);

  // Another project: nothing of the one before may stay in the list.
  useEffect(() => {
    setSessions([]);
    setNamed([]);
    setListFailed(false);
  }, [projectId]);

  // Every change makes a version, so the list follows the building, a moment later.
  useEffect(() => {
    if (!projectId || preview) return;
    let current = true;
    const timer = setTimeout(() => {
      fetchVersions()
        .then((entries) => {
          if (!current) return;
          setSessions(groupSessions(entries));
          setListFailed(false);
        })
        .catch(() => {
          if (current) setListFailed(true);
        });
      void listNamed(projectId)
        .then((list) => {
          if (current) setNamed(list);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [projectId, building, preview, round]);

  if (!projectId) return <p className="text-sm text-muted">{t("history.local")}</p>;
  if (sessions.length === 0 && listFailed) return <Hint error>{t("history.loadFailed")}</Hint>;
  if (sessions.length === 0) return <p className="text-sm text-muted">{t("history.empty")}</p>;
  const live = sessions[0]?.version;

  const show = async (version: number, actor: string, createdAt: string) => {
    setFailed(null);
    if (version === live) {
      endVersionPreview();
      return;
    }
    const old = await fetchVersion(version).catch(() => null);
    if (!old) {
      setFailed(version);
      return;
    }
    showVersion(old, { version, actor, createdAt });
  };

  const report = async (version: number, title: string) => {
    const cfg = syncConfigFromEnv();
    if (!cfg) return;
    setReportFailed(false);
    try {
      const res = await fetch(
        `${cfg.apiUrl}/reports/${encodeURIComponent(projectId)}?lang=${language}&version=${String(version)}`,
        { method: "POST", headers: await authHeaders() },
      );
      if (!res.ok) throw new Error(String(res.status));
      downloadFile(
        await res.blob(),
        buildingFileName(`${building.name} ${title}`, "pdf"),
        "application/pdf",
      );
    } catch {
      setReportFailed(true);
    }
  };

  const saveName = async () => {
    const text = name.trim();
    if (!text) return;
    await nameVersion(projectId, text).catch(() => undefined);
    setNaming(false);
    setName("");
    setRound((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <SectionLabel>{t("history.named")}</SectionLabel>
        {named.map((v) => (
          <NamedRow
            key={v.id}
            item={v}
            editor={editor}
            current={preview?.version === v.version}
            onShow={() => void show(v.version, v.name, v.createdAt)}
            onCompare={() => {
              setComparing({ version: v.version, name: v.name });
            }}
            onReport={() => void report(v.version, v.name)}
            onRename={async (next) => {
              await renameNamed(projectId, v.id, next).catch(() => undefined);
              setRound((n) => n + 1);
            }}
            onRemove={async () => {
              await deleteNamed(projectId, v.id).catch(() => undefined);
              setRound((n) => n + 1);
            }}
          />
        ))}
        {editor &&
          (naming ? (
            <div className="flex flex-col gap-2">
              <CustomFormInput
                label={t("history.nameThis")}
                value={name}
                onChange={setName}
                hint={t("history.namePlaceholder")}
                maxLength={80}
                autoFocus
              />
              <div className="flex gap-2">
                <CustomButton
                  variant="primary"
                  disabled={!name.trim()}
                  onClick={() => void saveName()}
                >
                  {t("history.nameSave")}
                </CustomButton>
                <CustomButton
                  variant="quiet"
                  onClick={() => {
                    setNaming(false);
                  }}
                >
                  {t("threads.cancel")}
                </CustomButton>
              </div>
            </div>
          ) : (
            <CustomButton
              icon={<Star size={14} aria-hidden />}
              onClick={() => {
                setNaming(true);
              }}
            >
              {t("history.nameThis")}
            </CustomButton>
          ))}
        <Presence show={reportFailed}>
          <Hint error>{t("history.reportFailed")}</Hint>
        </Presence>
      </section>

      <section className="flex flex-col gap-0.5">
        <SectionLabel>{t("history.sessions")}</SectionLabel>
        <ol className="flex flex-col gap-0.5" aria-label={t("history.title")}>
          {sessions.map((session) => {
            const current = preview
              ? preview.version === session.version
              : session.version === live;
            const what = session.created
              ? t("history.created")
              : changeText(session.summary, t) ||
                (session.changes === 1
                  ? t("history.change")
                  : t("history.changes", { count: session.changes }));
            const when =
              session.start === session.end
                ? clock(session.end)
                : t("history.span", { from: clock(session.start), to: clock(session.end) });
            return (
              <li key={session.version} className="group relative">
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => void show(session.version, session.actor, session.end)}
                  className={cx(
                    "flex w-full flex-col items-start gap-0.5 rounded-control px-2.5 py-2 pr-10 text-left transition-colors hover:bg-panel",
                    current && "bg-select-soft hover:bg-select-soft",
                  )}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">{session.actor}</span>
                    <span className="shrink-0 font-num text-xs text-muted">
                      {session.version === live
                        ? t("history.live", { version: session.version })
                        : t("history.version", { version: session.version })}
                    </span>
                  </span>
                  <span className="text-xs text-muted">{when}</span>
                  <span className="text-xs text-ink">{what}</span>
                  {failed === session.version && (
                    <span className="text-xs text-mark">{t("history.unavailable")}</span>
                  )}
                </button>
                {session.version !== live && (
                  <CustomIconButton
                    label={t("history.compareNow")}
                    size="xs"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => {
                      setComparing({
                        version: session.version,
                        name: t("history.version", { version: session.version }),
                      });
                    }}
                  >
                    <GitCompare size={12} aria-hidden />
                  </CustomIconButton>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <Presence value={comparing} kind="float">
        {(c) => (
          <CompareDialog
            version={c.version}
            name={c.name}
            onClose={() => {
              setComparing(null);
            }}
          />
        )}
      </Presence>
    </div>
  );
}

function NamedRow({
  item,
  editor,
  current,
  onShow,
  onCompare,
  onReport,
  onRename,
  onRemove,
}: {
  item: NamedVersion;
  editor: boolean;
  current: boolean;
  onShow: () => void;
  onCompare: () => void;
  onReport: () => void;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const by = item.namedBy ? `${item.namedBy.firstName} ${item.namedBy.lastName}` : "";
  return (
    <div
      className={cx(
        "flex flex-col gap-1.5 rounded-control border border-line px-2.5 py-2",
        current && "border-select bg-select-soft",
      )}
    >
      {renaming ? (
        <div className="flex flex-col gap-1.5">
          <CustomFormInput
            label={t("history.rename")}
            value={draft}
            onChange={setDraft}
            maxLength={80}
            autoFocus
          />
          <div className="flex gap-1.5">
            <CustomButton
              variant="primary"
              disabled={!draft.trim()}
              onClick={() => {
                void onRename(draft.trim()).then(() => {
                  setRenaming(false);
                });
              }}
            >
              {t("threads.save")}
            </CustomButton>
            <CustomButton
              variant="quiet"
              onClick={() => {
                setRenaming(false);
              }}
            >
              {t("threads.cancel")}
            </CustomButton>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Star size={14} className="mt-0.5 shrink-0 text-sun" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">{item.name}</div>
            <div className="truncate text-xs text-muted">
              {t("history.version", { version: item.version })}
              {by &&
                ` · ${t("history.namedBy", { name: by, when: formatRelative(item.createdAt, language) })}`}
            </div>
          </div>
          {editor && (
            <>
              <CustomIconButton
                label={t("history.rename")}
                size="xs"
                onClick={() => {
                  setDraft(item.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={12} aria-hidden />
              </CustomIconButton>
              <CustomIconButton
                label={t("history.unname")}
                size="xs"
                onClick={() => void onRemove()}
              >
                <X size={12} aria-hidden />
              </CustomIconButton>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <CustomButton variant="quiet" onClick={onShow}>
          {t("history.show")}
        </CustomButton>
        <CustomButton
          variant="quiet"
          icon={<GitCompare size={14} aria-hidden />}
          onClick={onCompare}
        >
          {t("history.compareNow")}
        </CustomButton>
        <CustomButton variant="quiet" icon={<FileDown size={14} aria-hidden />} onClick={onReport}>
          {t("history.report")}
        </CustomButton>
      </div>
    </div>
  );
}
