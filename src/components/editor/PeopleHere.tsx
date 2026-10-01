import { useMemo, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { useAuth } from "@/auth/store";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import { listMembers } from "@/projects/collab";
import type { Member } from "@/projects/collab";
import type { Presence as Tab } from "@/store/building";
import { people } from "./people";
import { useEditorStore } from "@/store/building";
import { Avatar } from "@/components/shared/Avatar";
import { CustomButton } from "@/components/shared/CustomButton";
import { Floating } from "@/components/shared/Floating";
import { Popover } from "@/components/shared/Popover";
import { Presence } from "@/components/shared/Presence";
import { SectionLabel } from "@/components/shared/PageTitle";
import { useDismiss } from "@/components/shared/useDismiss";

const PAGE_KEY: Record<string, MessageKey> = {
  building: "project.step.survey",
  editor: "project.step.model",
  variants: "project.step.variants",
  report: "project.step.report",
};
/** Avatars shown in the header before the rest fold into "+N". */
const SHOWN = 4;

/**
 * Who has this project open right now (TODO Part 21, CC.3): one avatar per person, a green dot
 * while they are here and faded while away. Opening it lists where each one is, lets the
 * viewer follow them, and names the members who are not here with when they last were.
 */
export function PeopleHere() {
  const t = useT();
  const tabs = useEditorStore((s) => s.presence);
  const projectId = useEditorStore((s) => s.projectId);
  const following = useEditorStore((s) => s.following);
  const setFollowing = useEditorStore((s) => s.setFollowing);
  const storeys = useEditorStore((s) => s.building.storeys);
  const language = useEditorStore((s) => s.language);
  const me = useAuth((s) => s.account);
  const accounts = useAuth((s) => s.status) === "signedIn";
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => {
    setOpen(false);
  });

  const others = useMemo(() => people(tabs).filter((p) => p.userId !== me?.id), [tabs, me?.id]);
  if (others.length === 0 && !open) return null;
  const here = new Set(others.map((p) => p.userId));
  const absent = members.filter((m) => m.userId !== me?.id && !here.has(m.userId));

  const where = (tab: Tab) => {
    const page = tab.page ? PAGE_KEY[tab.page] : undefined;
    const storey = storeys.find((s) => s.id === tab.storeyId)?.name;
    return [page ? t(page) : null, storey].filter(Boolean).join(" · ");
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && accounts && projectId) {
      void listMembers(projectId)
        .then(setMembers)
        .catch(() => {
          setMembers([]);
        });
    }
  };

  return (
    <div ref={root} className="relative mr-1">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("presence.people")}
        title={t("presence.people")}
        onClick={toggle}
        className="flex items-center -space-x-1.5 rounded-full p-0.5"
      >
        {others.slice(0, SHOWN).map((person) => (
          <Avatar
            key={person.key}
            userId={person.userId}
            firstName={person.firstName}
            lastName={person.lastName}
            status={person.state}
            ring
          />
        ))}
        {others.length > SHOWN && (
          <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted ring-2 ring-paper">
            +{others.length - SHOWN}
          </span>
        )}
      </button>
      <Presence show={open} kind="float">
        <Popover className="absolute top-11 right-0 flex w-80 flex-col gap-3">
          <SectionLabel>{t("presence.here")}</SectionLabel>
          {others.map((person) => (
            <div key={person.key} className="flex items-center gap-3">
              <Avatar
                userId={person.userId}
                firstName={person.firstName}
                lastName={person.lastName}
                status={person.state}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {person.firstName} {person.lastName}
                </div>
                <div className="truncate text-xs text-muted">
                  {person.state === "away" ? t("presence.away") : where(person.tab)}
                  {person.tabs > 1 && ` · ${t("presence.tabs", { count: person.tabs })}`}
                </div>
              </div>
              <CustomButton
                variant="quiet"
                icon={<Eye size={14} aria-hidden />}
                onClick={() => {
                  setFollowing(following === person.tab.clientId ? null : person.tab.clientId);
                  setOpen(false);
                }}
              >
                {following === person.tab.clientId
                  ? t("presence.stopFollow")
                  : t("presence.follow")}
              </CustomButton>
            </div>
          ))}
          {absent.length > 0 && (
            <>
              <SectionLabel>{t("presence.notHere")}</SectionLabel>
              {absent.map((member) => (
                <div key={member.userId} className="flex items-center gap-3">
                  <Avatar
                    userId={member.userId}
                    firstName={member.firstName}
                    lastName={member.lastName}
                    className="opacity-50"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      {member.firstName} {member.lastName}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {member.lastSeenAt
                        ? t("presence.lastHere", {
                            when: formatRelative(member.lastSeenAt, language),
                          })
                        : t("presence.neverHere")}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </Popover>
      </Presence>
    </div>
  );
}

/** While following someone: a frame in their colour round the view, and how to stop. */
export function FollowFrame() {
  const t = useT();
  const following = useEditorStore((s) => s.following);
  const tab = useEditorStore((s) => s.presence.find((p) => p.clientId === s.following));
  const setFollowing = useEditorStore((s) => s.setFollowing);
  return (
    <Presence value={following && tab ? tab : null} kind="float">
      {(person) => (
        <Floating
          fade
          className="pointer-events-none absolute inset-0 z-10 rounded-[2px] border-[3px]"
          style={{ borderColor: person.color }}
        >
          <div
            className="pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-float"
            style={{ background: person.color }}
          >
            {t("presence.following", { name: person.actor })}
            <button
              type="button"
              className="underline"
              title={t("presence.followHint")}
              onClick={() => {
                setFollowing(null);
              }}
            >
              {t("presence.stopFollow")}
            </button>
          </div>
        </Floating>
      )}
    </Presence>
  );
}
