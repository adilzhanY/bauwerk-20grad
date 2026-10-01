import { Fragment, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, Paperclip, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { sameTarget } from "@/geometry/notes";
import type { NoteTarget } from "@/geometry/types";
import { useAuth } from "@/auth/store";
import { useT } from "@/i18n/useT";
import { formatRelative } from "@/lib/format";
import {
  deleteComment,
  editComment,
  fileBlob,
  listFiles,
  listMembers,
  replyTo,
  resolveThread,
  startThread,
  uploadFile,
} from "@/projects/collab";
import type { Member, ProjectFile, Thread, ThreadComment } from "@/projects/collab";
import { can } from "@/projects/roles";
import { reloadThreads, useThreads } from "@/projects/threads";
import { useEditorStore } from "@/store/building";
import { Avatar } from "@/components/shared/Avatar";
import { CustomButton } from "@/components/shared/CustomButton";
import { CustomIconButton } from "@/components/shared/CustomIconButton";
import { CustomTextArea } from "@/components/shared/CustomTextArea";
import { cx } from "@/components/shared/cx";
import { Hint } from "@/components/shared/Hint";
import { Presence } from "@/components/shared/Presence";

/** The @word being typed at the end of the text, if any. */
const typingMention = (text: string) => /(?:^|\s)@([A-Za-z0-9_-]{0,24})$/.exec(text)?.[1];

/** A comment's text with its @mentions marked. */
function Text({ text }: { text: string }) {
  const parts = text.split(/((?:^|(?<=\s))@[A-Za-z0-9_-]{3,24})/g);
  return (
    <p className="text-sm whitespace-pre-wrap text-ink">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <span key={i} className="rounded-soft bg-select-soft px-0.5 font-medium text-select">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/**
 * Notes as threads (TODO Part 21, CE): about the selected element, or the building. Each
 * thread holds comments with @mentions and attachments; commenters and up write, reply and
 * resolve; a comment's author edits it, its author or the owner deletes it.
 */
export function ThreadsSection({ target }: { target: NoteTarget }) {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId);
  const role = useEditorStore((s) => s.projectRole);
  const all = useThreads((s) => s.threads);
  const [showResolved, setShowResolved] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const writer = role === null || can(role, "comment");

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void Promise.all([
      listMembers(projectId).catch(() => []),
      listFiles(projectId).catch(() => []),
    ]).then(([people, list]) => {
      if (!live) return;
      setMembers(people);
      setFiles(list);
    });
    return () => {
      live = false;
    };
  }, [projectId, all]);

  if (!projectId) return null;
  const here = all.filter((thread) => sameTarget(thread.target, target));
  const open = here.filter((thread) => !thread.resolvedAt);
  const resolved = here.filter((thread) => thread.resolvedAt);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-xs font-semibold text-ink">
        {t("threads.title")}
        {open.length > 0 && <span className="font-normal text-muted"> · {open.length}</span>}
      </span>
      {open.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          members={members}
          files={files}
          writer={writer}
        />
      ))}
      {resolved.length > 0 && (
        <button
          type="button"
          className="self-start text-xs text-muted underline"
          onClick={() => {
            setShowResolved(!showResolved);
          }}
        >
          {showResolved
            ? t("threads.hideResolved")
            : t("threads.showResolved", { n: resolved.length })}
        </button>
      )}
      <Presence show={showResolved} className="flex flex-col gap-2">
        {resolved.map((thread) => (
          <ThreadCard
            key={thread.id}
            thread={thread}
            members={members}
            files={files}
            writer={writer}
          />
        ))}
      </Presence>
      {writer ? (
        <Composer
          label={t("threads.new")}
          placeholder={t("threads.newPlaceholder")}
          members={members}
          onSend={async (text, attachments) => {
            await startThread(projectId, target, text, attachments);
            await reloadThreads();
          }}
        />
      ) : (
        <Hint>{t("threads.readOnly")}</Hint>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  members,
  files,
  writer,
}: {
  thread: Thread;
  members: readonly Member[];
  files: readonly ProjectFile[];
  writer: boolean;
}) {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId) ?? "";
  const [replying, setReplying] = useState(false);
  const done = thread.resolvedAt !== null;
  return (
    <div
      className={cx(
        "flex flex-col gap-2.5 rounded-inner border border-line bg-paper p-2.5",
        done && "opacity-70",
      )}
    >
      {thread.comments.map((comment) => (
        <CommentRow key={comment.id} comment={comment} files={files} writer={writer} />
      ))}
      {writer && (
        <div className="flex flex-wrap gap-1.5">
          {!done && !replying && (
            <CustomButton
              variant="quiet"
              onClick={() => {
                setReplying(true);
              }}
            >
              {t("threads.reply")}
            </CustomButton>
          )}
          <CustomButton
            variant="quiet"
            icon={done ? <RotateCcw size={14} aria-hidden /> : <Check size={14} aria-hidden />}
            onClick={() => {
              void resolveThread(projectId, thread.id, !done).then(reloadThreads);
            }}
          >
            {done ? t("threads.reopen") : t("threads.resolve")}
          </CustomButton>
        </div>
      )}
      <Presence show={replying && !done}>
        <Composer
          label={t("threads.reply")}
          placeholder={t("threads.replyPlaceholder")}
          members={members}
          autoFocus
          onCancel={() => {
            setReplying(false);
          }}
          onSend={async (text, attachments) => {
            await replyTo(projectId, thread.id, text, attachments);
            setReplying(false);
            await reloadThreads();
          }}
        />
      </Presence>
    </div>
  );
}

function CommentRow({
  comment,
  files,
  writer,
}: {
  comment: ThreadComment;
  files: readonly ProjectFile[];
  writer: boolean;
}) {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId) ?? "";
  const role = useEditorStore((s) => s.projectRole);
  const language = useEditorStore((s) => s.language);
  const me = useAuth((s) => s.account);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const mine = me !== null && comment.authorId === me.id;
  const [first = "", ...rest] = comment.authorName.split(" ");

  const openFile = async (fileId: string) => {
    const tab = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await fileBlob(projectId, fileId));
      if (tab) tab.location.href = url;
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {
      tab?.close();
    }
  };

  return (
    <div className="flex gap-2">
      <Avatar
        userId={comment.authorId ?? comment.authorName}
        firstName={first}
        lastName={rest.join(" ")}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-xs font-semibold text-ink">{comment.authorName}</span>
          <span className="shrink-0 text-xs text-muted">
            {formatRelative(comment.createdAt, language)}
            {comment.editedAt && ` · ${t("threads.edited")}`}
          </span>
          <span className="flex-1" />
          {writer && mine && !editing && (
            <CustomIconButton
              label={t("threads.edit")}
              size="xs"
              onClick={() => {
                setDraft(comment.text);
                setEditing(true);
              }}
            >
              <Pencil size={12} aria-hidden />
            </CustomIconButton>
          )}
          {writer && (mine || can(role, "manage")) && (
            <CustomIconButton
              label={t("threads.delete")}
              size="xs"
              onClick={() => {
                void deleteComment(projectId, comment.id).then(reloadThreads);
              }}
            >
              <Trash2 size={12} aria-hidden />
            </CustomIconButton>
          )}
        </div>
        {editing ? (
          <div className="mt-1 flex flex-col gap-1.5">
            <CustomTextArea
              label={t("threads.edit")}
              hideLabel
              value={draft}
              onChange={setDraft}
              rows={2}
              autoFocus
            />
            <div className="flex gap-1.5">
              <CustomButton
                variant="primary"
                disabled={!draft.trim()}
                onClick={() => {
                  void editComment(projectId, comment.id, draft.trim()).then(async () => {
                    setEditing(false);
                    await reloadThreads();
                  });
                }}
              >
                {t("threads.save")}
              </CustomButton>
              <CustomButton
                variant="quiet"
                onClick={() => {
                  setEditing(false);
                }}
              >
                {t("threads.cancel")}
              </CustomButton>
            </div>
          </div>
        ) : (
          <Text text={comment.text} />
        )}
        {comment.attachments.map((fileId) => {
          const file = files.find((f) => f.id === fileId);
          return (
            <button
              key={fileId}
              type="button"
              className="mt-1 mr-1 inline-flex max-w-full items-center gap-1 rounded-soft border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
              onClick={() => {
                void openFile(fileId);
              }}
            >
              <Paperclip size={12} aria-hidden />
              <span className="truncate">{file?.name ?? "…"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Writing a comment: @ suggests people with access, files can be attached, Ctrl+Enter sends. */
function Composer({
  label,
  placeholder,
  members,
  autoFocus,
  onSend,
  onCancel,
}: {
  label: string;
  placeholder: string;
  members: readonly Member[];
  autoFocus?: boolean;
  onSend: (text: string, attachments: string[]) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useT();
  const projectId = useEditorStore((s) => s.projectId) ?? "";
  const me = useAuth((s) => s.account);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const typed = typingMention(text);
  const suggestions =
    typed === undefined
      ? []
      : members
          .filter((m) => m.userId !== me?.id)
          .filter((m) =>
            [m.username, m.firstName, m.lastName].some((s) =>
              s.toLowerCase().startsWith(typed.toLowerCase()),
            ),
          )
          .slice(0, 5);

  const mention = (member: Member) => {
    setText(text.replace(/@([A-Za-z0-9_-]{0,24})$/, `@${member.username} `));
    area.current?.focus();
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSend(
        body,
        attached.map((f) => f.id),
      );
      setText("");
      setAttached([]);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <CustomTextArea
        label={label}
        hideLabel
        value={text}
        onChange={setText}
        placeholder={placeholder}
        rows={2}
        maxLength={5000}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        textareaRef={area}
      />
      <Presence show={suggestions.length > 0}>
        <ul
          aria-label={t("threads.mentionList")}
          className="flex flex-col rounded-inner border border-line bg-paper p-1"
        >
          {suggestions.map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-soft px-1.5 py-1 text-left hover:bg-panel"
                onClick={() => {
                  mention(member);
                }}
              >
                <Avatar
                  userId={member.userId}
                  firstName={member.firstName}
                  lastName={member.lastName}
                  size="xs"
                />
                <span className="truncate text-xs text-ink">
                  {member.firstName} {member.lastName}
                </span>
                <span className="truncate text-xs text-muted">@{member.username}</span>
              </button>
            </li>
          ))}
        </ul>
      </Presence>
      {attached.map((file) => (
        <span
          key={file.id}
          className="inline-flex items-center gap-1 self-start rounded-soft border border-line bg-panel px-1.5 py-0.5 text-xs"
        >
          {t("threads.attached", { name: file.name })}
          <button
            type="button"
            aria-label={t("threads.removeAttachment", { name: file.name })}
            onClick={() => {
              setAttached(attached.filter((f) => f.id !== file.id));
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <div className="flex items-center gap-1.5">
        <CustomButton
          variant="primary"
          loading={busy}
          disabled={!text.trim()}
          onClick={() => void send()}
        >
          {t("threads.send")}
        </CustomButton>
        <CustomIconButton
          label={t("threads.attach")}
          size="sm"
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={14} aria-hidden />
        </CustomIconButton>
        {onCancel && (
          <CustomButton variant="quiet" onClick={onCancel}>
            {t("threads.cancel")}
          </CustomButton>
        )}
        <span className="flex-1" />
        <span className="text-xs text-faint">{t("threads.sendHint")}</span>
      </div>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        aria-label={t("threads.attach")}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void uploadFile(projectId, file)
            .then((stored) => {
              setAttached([...attached, stored]);
            })
            .catch(() => {
              setFailed(true);
            });
        }}
      />
      <Presence show={failed}>
        <Hint error>{t("threads.failed")}</Hint>
      </Presence>
    </div>
  );
}
