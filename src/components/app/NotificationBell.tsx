import { useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useRouter } from "@/app/router";
import { useAuth } from "@/auth/store";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import { answerRequest } from "@/projects/collab";
import type { Notice } from "@/projects/collab";
import { readNotices, useInbox } from "@/projects/inbox";
import { openServerProject } from "@/projects/projects";
import { isRole } from "@/projects/roles";
import { confirmLeave } from "@/projects/session";
import { useEditorStore } from "@/store/building";
import { Avatar } from "@/components/shared/Avatar";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { cx } from "@/components/shared/cx";
import { Hint } from "@/components/shared/Hint";
import { Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { SectionLabel } from "@/components/shared/PageTitle";
import { useDismiss } from "@/components/shared/useDismiss";

/**
 * The bell in the top bar (TODO Part 21, CF.3): what concerns the signed in person, newest
 * first and grouped by project, live on every page. A click opens the project and marks the
 * item read; a request for access is answered right here.
 */
export function NotificationBell() {
  const t = useT();
  const signedIn = useAuth((s) => s.status) === "signedIn";
  const items = useInbox((s) => s.items);
  const unread = useInbox((s) => s.unread);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => {
    setOpen(false);
  });
  if (!signedIn) return null;

  // Grouped by project, in the order of each project's newest item.
  const groups: { key: string; name: string | null; items: Notice[] }[] = [];
  for (const item of items) {
    const key = item.projectId ?? "none";
    const group = groups.find((g) => g.key === key);
    if (group) group.items.push(item);
    else groups.push({ key, name: item.projectName, items: [item] });
  }

  return (
    <div ref={root} className="relative">
      <CustomIconButton
        label={unread > 0 ? t("inbox.button", { n: unread }) : t("inbox.buttonNone")}
        size="md"
        pressed={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Bell size={17} aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-mark px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </CustomIconButton>
      <Presence show={open} kind="float">
        <Popover className="absolute top-11 right-0 flex max-h-[70vh] w-96 flex-col gap-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{t("inbox.title")}</span>
            {unread > 0 && (
              <CustomButton
                variant="quiet"
                onClick={() => {
                  void readNotices("all");
                }}
              >
                {t("inbox.markAll")}
              </CustomButton>
            )}
          </div>
          {items.length === 0 && <Hint>{t("inbox.empty")}</Hint>}
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1">
              <SectionLabel>{group.name ?? t("inbox.aProject")}</SectionLabel>
              {group.items.map((item) => (
                <Item
                  key={item.id}
                  item={item}
                  onDone={() => {
                    setOpen(false);
                  }}
                />
              ))}
            </section>
          ))}
        </Popover>
      </Presence>
    </div>
  );
}

function Item({ item, onDone }: { item: Notice; onDone: () => void }) {
  const t = useT();
  const navigate = useRouter((s) => s.navigate);
  const language = useEditorStore((s) => s.language);
  const [answered, setAnswered] = useState(false);
  const actor = item.actor ? `${item.actor.firstName} ${item.actor.lastName}` : t("inbox.someone");
  const project = item.projectName ?? t("inbox.aProject");
  const role = isRole(item.payload.role) ? t(`role.${item.payload.role}` as MessageKey) : "";
  const text = typeof item.payload.text === "string" ? item.payload.text : null;
  const message = typeof item.payload.message === "string" ? item.payload.message : null;
  const key: MessageKey =
    item.kind === "replied" && item.count > 1
      ? "inbox.repliedMany"
      : (`inbox.${item.kind}` as MessageKey);

  const go = async () => {
    void readNotices([item.id]);
    if (!item.projectId || item.kind === "removed") return;
    if (!(await confirmLeave())) return;
    onDone();
    await openServerProject(item.projectId).catch(() => undefined);
    navigate({ page: "editor" });
  };

  const answer = (as: "viewer" | "commenter" | null) => {
    if (!item.projectId || !item.actor) return;
    setAnswered(true);
    void readNotices([item.id]);
    void answerRequest(item.projectId, item.actor.id, as).catch(() => {
      setAnswered(false);
    });
  };

  return (
    <div
      className={cx(
        "flex gap-2.5 rounded-inner px-1.5 py-1.5",
        item.readAt === null && "bg-select-soft",
      )}
    >
      {item.actor ? (
        <Avatar
          userId={item.actor.id}
          firstName={item.actor.firstName}
          lastName={item.actor.lastName}
        />
      ) : (
        <span className="h-7 w-7 shrink-0 rounded-full bg-panel-2" />
      )}
      <div className="min-w-0 flex-1">
        <button type="button" className="block w-full text-left" onClick={() => void go()}>
          <span className="block text-sm text-ink">
            {t(key, { actor, project, role, n: item.count })}
          </span>
          {(text ?? message) && (
            <span className="mt-0.5 block truncate text-xs text-muted">"{text ?? message}"</span>
          )}
          <span className="mt-0.5 block text-xs text-faint">
            {formatRelative(item.createdAt, language)}
          </span>
        </button>
        {item.kind === "accessRequested" &&
          (answered ? (
            <Hint>{t("inbox.answered")}</Hint>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <CustomButton
                variant="primary"
                onClick={() => {
                  answer("commenter");
                }}
              >
                {t("inbox.letInAs", { role: t("role.commenter") })}
              </CustomButton>
              <CustomButton
                onClick={() => {
                  answer("viewer");
                }}
              >
                {t("inbox.letInAs", { role: t("role.viewer") })}
              </CustomButton>
              <CustomButton
                variant="quiet"
                onClick={() => {
                  answer(null);
                }}
              >
                {t("inbox.decline")}
              </CustomButton>
            </div>
          ))}
      </div>
    </div>
  );
}
