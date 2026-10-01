import { useEffect, useMemo, useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/auth/store";
import type { MessageKey } from "@/i18n";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import {
  accessRequests,
  answerRequest,
  changeRole,
  getLink,
  invite,
  listMembers,
  removeLink,
  removeMember,
  searchPeople,
  setLink,
  shareUrl,
} from "@/projects/collab";
import type { AccessRequest, Member, Person, ShareLink } from "@/projects/collab";
import { can } from "@/projects/roles";
import type { LinkRole, Role } from "@/projects/roles";
import { useEditorStore } from "@/store/building";
import { Avatar } from "@/components/shared/Avatar";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomDialog } from "@/components/shared/CustomDialog";
import { CustomFormInput } from "@/components/shared/CustomFormInput";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomSegmented } from "@/components/shared/CustomSegmented";
import { CustomSelect } from "@/components/shared/CustomSelect";
import { Hint } from "@/components/shared/Hint";
import { Notice } from "@/components/shared/Notice";
import { SectionLabel } from "@/components/shared/PageTitle";
import { Presence } from "@/components/shared/Presence";

type Given = Exclude<Role, "owner">;
const GIVEN: Given[] = ["editor", "commenter", "viewer"];
const SEARCH_DELAY_MS = 250;
const EXPIRY_DAYS = { never: 0, day: 1, week: 7, month: 30 } as const;
type Expiry = keyof typeof EXPIRY_DAYS;

const roleKey = (role: Role) => `role.${role}` as MessageKey;
const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/**
 * Who has access to the open project, and how others get it (TODO Part 21, CB.7): the owner
 * finds people by name and invites them with a role, changes roles, hands the project over,
 * answers requests and sets the share link (view or comment, never edit); everyone else sees
 * the list and may leave.
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const role = useEditorStore((s) => s.projectRole);
  const me = useAuth((s) => s.account);
  const accounts = useAuth((s) => s.status) !== "off";
  const owner = can(role, "manage");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [error, setError] = useState(false);
  /** Counts changes made here; each one reloads the lists. */
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    Promise.all([listMembers(projectId), owner ? accessRequests(projectId) : []])
      .then(([people, asking]) => {
        if (!live) return;
        setMembers(people);
        setRequests(asking);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [projectId, owner, round]);

  const act = async (job: () => Promise<unknown>) => {
    setError(false);
    try {
      await job();
    } catch {
      setError(true);
    }
    setRound((n) => n + 1);
  };

  if (!projectId) return null;
  if (!accounts) return <AddressOnly onClose={onClose} />;
  return (
    <CustomDialog
      title={t("share.title")}
      closeLabel={t("share.close")}
      onClose={onClose}
      width={540}
    >
      <div className="flex flex-col gap-5">
        {owner ? (
          <PersonSearch
            members={members ?? []}
            onInvite={(person, given) => act(() => invite(projectId, person.id, given))}
          />
        ) : (
          <Hint>{t("share.viewOnlyNote")}</Hint>
        )}

        <section className="flex flex-col gap-1">
          <SectionLabel>{t("share.people")}</SectionLabel>
          {(members ?? []).map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              isMe={member.userId === me?.id}
              owner={owner}
              onRole={(next) => act(() => changeRole(projectId, member.userId, next))}
              onRemove={() =>
                act(async () => {
                  await removeMember(projectId, member.userId);
                  if (member.userId === me?.id) onClose();
                })
              }
            />
          ))}
        </section>

        <Presence show={owner && requests.length > 0}>
          <section className="flex flex-col gap-1">
            <SectionLabel>{t("share.requests")}</SectionLabel>
            {requests.map((request) => (
              <RequestRow
                key={request.userId}
                request={request}
                onAnswer={(given) => act(() => answerRequest(projectId, request.userId, given))}
              />
            ))}
          </section>
        </Presence>

        {owner && (
          <LinkSection
            projectId={projectId}
            onError={() => {
              setError(true);
            }}
          />
        )}

        <Presence show={error}>
          <Hint error>{t("share.error")}</Hint>
        </Presence>
      </div>
    </CustomDialog>
  );
}

function PersonSearch({
  members,
  onInvite,
}: {
  members: readonly Member[];
  onInvite: (person: Person, role: Given) => Promise<void>;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);
  const [roles, setRoles] = useState<Record<string, Given>>({});
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void searchPeople(q)
        .then((people) => {
          if (live) setFound(people);
        })
        .catch(() => {
          if (live) setFound([]);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const inside = useMemo(() => new Set(members.map((m) => m.userId)), [members]);
  const roleOptions = GIVEN.map((r) => ({
    value: r,
    label: t(roleKey(r)),
    detail: t(`role.${r}Hint` as MessageKey),
  }));

  return (
    <section className="flex flex-col gap-2">
      <CustomFormInput
        label={t("share.searchLabel")}
        value={query}
        onChange={setQuery}
        hint={t("share.searchHint")}
        autoComplete="off"
        maxLength={40}
        autoFocus
      />
      <Presence value={q.length < 2 ? null : found}>
        {(people) =>
          people.length === 0 ? (
            <Hint>{t("share.searchNone")}</Hint>
          ) : (
            <ul className="flex flex-col gap-1">
              {people.map((person) => {
                const has = inside.has(person.id);
                const done = invited.has(person.id);
                return (
                  <li key={person.id} className="flex items-center gap-3 rounded-control px-1 py-1">
                    <Avatar
                      userId={person.id}
                      firstName={person.firstName}
                      lastName={person.lastName}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{name(person)}</div>
                      <div className="truncate text-xs text-muted">@{person.username}</div>
                    </div>
                    {has || done ? (
                      <span className="text-xs text-muted">
                        {done ? t("share.invited") : t("share.hasAccess")}
                      </span>
                    ) : (
                      <>
                        <CustomSelect
                          label={t("share.searchLabel")}
                          hideLabel
                          value={roles[person.id] ?? "editor"}
                          options={roleOptions}
                          onChange={(value) => {
                            setRoles({ ...roles, [person.id]: value });
                          }}
                        />
                        <CustomButton
                          variant="primary"
                          onClick={() => {
                            void onInvite(person, roles[person.id] ?? "editor").then(() => {
                              setInvited(new Set(invited).add(person.id));
                            });
                          }}
                        >
                          {t("share.invite")}
                        </CustomButton>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        }
      </Presence>
    </section>
  );
}

function MemberRow({
  member,
  isMe,
  owner,
  onRole,
  onRemove,
}: {
  member: Member;
  isMe: boolean;
  owner: boolean;
  onRole: (role: Role) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [handOver, setHandOver] = useState(false);
  const fullName = name(member);
  const seen = member.lastSeenAt
    ? t("share.lastHere", { when: formatRelative(member.lastSeenAt, language) })
    : t("share.neverHere");
  const options = (["owner", ...GIVEN] as Role[]).map((r) => ({
    value: r,
    label: t(roleKey(r)),
    detail: t(`role.${r}Hint` as MessageKey),
  }));

  return (
    <div className="flex flex-col gap-2 rounded-control px-1 py-1">
      <div className="flex items-center gap-3">
        <Avatar userId={member.userId} firstName={member.firstName} lastName={member.lastName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">
            {fullName}
            {isMe && <span className="font-normal text-muted"> ({t("share.you")})</span>}
          </div>
          <div className="truncate text-xs text-muted">
            @{member.username} · {seen}
          </div>
        </div>
        {owner && member.role !== "owner" ? (
          <>
            <CustomSelect
              label={fullName}
              hideLabel
              value={member.role}
              options={options}
              onChange={(next) => {
                if (next === "owner") setHandOver(true);
                else void onRole(next);
              }}
            />
            <CustomIconButton
              label={t("share.remove", { name: fullName })}
              size="sm"
              onClick={() => {
                void onRemove();
              }}
            >
              <X size={15} aria-hidden />
            </CustomIconButton>
          </>
        ) : (
          <span className="text-xs text-muted">{t(roleKey(member.role))}</span>
        )}
        {isMe && !owner && (
          <CustomButton
            variant="quiet"
            onClick={() => {
              void onRemove();
            }}
          >
            {t("share.leave")}
          </CustomButton>
        )}
      </div>
      <Presence show={handOver}>
        <Notice tone="warning">
          <div className="flex flex-col gap-2">
            <b>{t("share.transferTitle", { name: fullName })}</b>
            <span>{t("share.transferBody", { name: fullName })}</span>
            <div className="flex gap-2">
              <CustomButton
                variant="primary"
                onClick={() => {
                  setHandOver(false);
                  void onRole("owner");
                }}
              >
                {t("share.transferConfirm")}
              </CustomButton>
              <CustomButton
                variant="quiet"
                onClick={() => {
                  setHandOver(false);
                }}
              >
                {t("share.cancel")}
              </CustomButton>
            </div>
          </div>
        </Notice>
      </Presence>
    </div>
  );
}

function RequestRow({
  request,
  onAnswer,
}: {
  request: AccessRequest;
  onAnswer: (role: Given | null) => Promise<void>;
}) {
  const t = useT();
  const [role, setRole] = useState<Given>("viewer");
  return (
    <div className="flex items-center gap-3 rounded-control px-1 py-1">
      <Avatar userId={request.userId} firstName={request.firstName} lastName={request.lastName} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{name(request)}</div>
        <div className="truncate text-xs text-muted">
          {request.message ? `"${request.message}"` : `@${request.username}`}
        </div>
      </div>
      <CustomSelect
        label={t("share.letIn")}
        hideLabel
        value={role}
        options={GIVEN.map((r) => ({ value: r, label: t(roleKey(r)) }))}
        onChange={setRole}
      />
      <CustomButton
        variant="primary"
        onClick={() => {
          void onAnswer(role);
        }}
      >
        {t("share.letIn")}
      </CustomButton>
      <CustomButton
        variant="quiet"
        onClick={() => {
          void onAnswer(null);
        }}
      >
        {t("share.decline")}
      </CustomButton>
    </div>
  );
}

function LinkSection({ projectId, onError }: { projectId: string; onError: () => void }) {
  const t = useT();
  const language = useEditorStore((s) => s.language);
  const [link, setCurrent] = useState<ShareLink | null | undefined>(undefined);
  const [expiry, setExpiry] = useState<Expiry>("never");
  const [copied, setCopied] = useState(false);
  const [wasReset, setWasReset] = useState(false);

  useEffect(() => {
    void getLink(projectId)
      .then(setCurrent)
      .catch(() => {
        setCurrent(null);
      });
  }, [projectId]);

  const until = (choice: Expiry) =>
    EXPIRY_DAYS[choice] === 0
      ? null
      : new Date(Date.now() + EXPIRY_DAYS[choice] * 86_400_000).toISOString();

  const apply = async (role: LinkRole | "off", choice: Expiry, reset = false) => {
    setCopied(false);
    setWasReset(false);
    try {
      if (role === "off") {
        await removeLink(projectId);
        setCurrent(null);
      } else {
        setCurrent(await setLink(projectId, { role, expiresAt: until(choice), reset }));
        if (reset) setWasReset(true);
      }
    } catch {
      onError();
    }
  };

  if (link === undefined) return null;
  const mode: LinkRole | "off" = link?.role ?? "off";
  const url = link ? shareUrl(projectId, link.token) : "";

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <SectionLabel>{t("share.link")}</SectionLabel>
      <CustomSegmented
        label={t("share.linkLabel")}
        value={mode}
        options={[
          { value: "off", label: t("share.linkOff") },
          { value: "viewer", label: t("role.viewer") },
          { value: "commenter", label: t("role.commenter") },
        ]}
        onChange={(value) => {
          void apply(value, expiry);
        }}
      />
      <Hint>
        {link ? t("share.linkHint", { role: t(roleKey(link.role)) }) : t("share.linkHintOff")}
      </Hint>
      <Presence value={link}>
        {(current) => (
          <div className="flex flex-col gap-2">
            <CustomSelect
              label={t("share.expiry")}
              value={expiry}
              options={[
                { value: "never", label: t("share.expiryNever") },
                { value: "day", label: t("share.expiryDay") },
                { value: "week", label: t("share.expiryWeek") },
                { value: "month", label: t("share.expiryMonth") },
              ]}
              onChange={(value) => {
                setExpiry(value);
                void apply(current.role, value);
              }}
            />
            {current.expiresAt && (
              <Hint>
                {t("share.expiresOn", {
                  date: new Date(current.expiresAt).toLocaleDateString(
                    language === "de" ? "de-DE" : "en-GB",
                  ),
                })}
              </Hint>
            )}
            <div className="rounded-control border border-line bg-panel px-3 py-2 font-num text-xs break-all text-ink select-all">
              {url}
            </div>
            <div className="flex flex-wrap gap-2">
              <CustomButton
                variant="primary"
                icon={copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
                disabled={!window.isSecureContext}
                onClick={() => {
                  void navigator.clipboard.writeText(url).then(() => {
                    setCopied(true);
                  });
                }}
              >
                {copied ? t("share.copied") : t("share.copy")}
              </CustomButton>
              <CustomButton
                variant="quiet"
                icon={<RefreshCw size={15} aria-hidden />}
                onClick={() => {
                  void apply(current.role, expiry, true);
                }}
              >
                {t("share.reset")}
              </CustomButton>
            </div>
            <Presence show={wasReset}>
              <Hint>{t("share.resetDone")}</Hint>
            </Presence>
          </div>
        )}
      </Presence>
    </section>
  );
}

/**
 * A server without accounts has no people or roles: whoever has the project's address is in
 * it, so the address is what is sent.
 */
function AddressOnly({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = window.location.href;
  return (
    <CustomDialog title={t("share.title")} closeLabel={t("share.close")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("share.body")}</p>
        <div className="rounded-control border border-line bg-panel px-3 py-2 font-num text-xs break-all text-ink select-all">
          {url}
        </div>
        <Presence show={window.isSecureContext}>
          <CustomButton
            variant="primary"
            icon={copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            onClick={() => {
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? t("share.copied") : t("share.copy")}
          </CustomButton>
        </Presence>
      </div>
    </CustomDialog>
  );
}
