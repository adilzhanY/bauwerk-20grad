import type { Params, MessageKey } from "@/i18n";
import type { Building, NoteTarget } from "@/geometry/types";
import type { Notice } from "@/projects/collab";
import type { ActivityEvent } from "@/sync/activity";
import { targetLabel } from "./noteTarget";

type Translate = (key: MessageKey, params?: Params) => string;

/**
 * A short toast about someone else's doing in this project: a mention of this person, or a
 * big change (a floor plan applied, a facade put on, a version restored). It closes by itself
 * after `ms` (paused while the pointer is on it); the inbox under the bell keeps the mention.
 */
export interface LiveToast {
  /** One toast per key: a second mention by the same person replaces the first. */
  key: string;
  text: string;
  /** The note's words, under the line, for a mention. */
  detail?: string;
  /** Where Show jumps to; absent, the toast has no Show. */
  jump?: { target: NoteTarget } | { storeyId: string };
  /** The inbox item a mention came from, marked read when Show is pressed. */
  noticeId?: string;
  ms: number;
}

/** Long enough to read a line and press Show; shorter for news without a question in it. */
export const MENTION_MS = 8000;
export const ACTIVITY_MS = 6000;
/** More at once is noise: the oldest goes. */
export const MAX_TOASTS = 3;

const nameOf = (notice: Notice) =>
  notice.actor ? `${notice.actor.firstName} ${notice.actor.lastName}`.trim() : "";

const isTarget = (value: unknown): value is NoteTarget =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { kind?: unknown }).kind === "string";

/** The toast for a new inbox item, when it is a mention in this project; else null. */
export function mentionToast(
  notice: Notice,
  projectId: string | null,
  building: Building,
  t: Translate,
): LiveToast | null {
  if (notice.kind !== "mentioned" || notice.readAt !== null) return null;
  if (!projectId || notice.projectId !== projectId) return null;
  const target = isTarget(notice.payload.target)
    ? notice.payload.target
    : { kind: "building" as const };
  const where = targetLabel(building, target, t);
  const name = nameOf(notice) || t("toast.someone");
  const text = typeof notice.payload.text === "string" ? notice.payload.text : undefined;
  return {
    key: `mention:${notice.actor?.id ?? notice.id}`,
    text: where ? t("toast.mentioned", { name, where }) : t("toast.mentionedBuilding", { name }),
    ...(text ? { detail: text } : {}),
    jump: { target },
    noticeId: notice.id,
    ms: MENTION_MS,
  };
}

/** The toast for someone else's big change, or null when it says nothing useful any more. */
export function activityToast(
  event: ActivityEvent,
  building: Building,
  t: Translate,
): LiveToast | null {
  const name = event.actor || t("toast.someone");
  const a = event.activity;
  switch (a.kind) {
    case "floorPlan": {
      const storey = building.storeys.find((s) => s.id === a.storeyId);
      if (!storey) return null;
      return {
        key: `floorPlan:${a.storeyId}`,
        text: t("toast.floorPlan", { name, storey: storey.name }),
        jump: { storeyId: a.storeyId },
        ms: ACTIVITY_MS,
      };
    }
    case "facade":
      return {
        key: `facade:${a.wallIndex}`,
        text: t("toast.facade", { name, n: a.count, wall: t("tree.wall", { n: a.wallIndex + 1 }) }),
        jump: { target: { kind: "wall", wallIndex: a.wallIndex } },
        ms: ACTIVITY_MS,
      };
    case "restore":
      return { key: "restore", text: t("toast.restore", { name, n: a.version }), ms: ACTIVITY_MS };
  }
}

/** Adds a toast on top: one per key (the newer wins), at most MAX_TOASTS. */
export function pushToast<T extends { key: string }>(list: readonly T[], toast: T): T[] {
  return [toast, ...list.filter((x) => x.key !== toast.key)].slice(0, MAX_TOASTS);
}
