import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DB } from "../db";

/** What can happen to someone (TODO Part 21, CF.2). */
export type NoticeKind =
  | "invited"
  | "roleChanged"
  | "removed"
  | "accessRequested"
  | "accessGranted"
  | "mentioned"
  | "replied"
  | "versionNamed";

/** One item of a person's inbox, with the names it shows. */
export interface Notice {
  id: string;
  kind: NoticeKind;
  projectId: string | null;
  projectName: string | null;
  actor: { id: string; firstName: string; lastName: string; username: string } | null;
  payload: Record<string, unknown>;
  /** Several replies in one thread fold into one item; how many it holds. */
  count: number;
  createdAt: string;
  readAt: string | null;
}

interface Row {
  id: string;
  kind: NoticeKind;
  project_id: string | null;
  project_name: string | null;
  actor_id: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  payload: Record<string, unknown>;
  count: number;
  created_at: Date;
  read_at: Date | null;
}

const toNotice = (r: Row): Notice => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  projectName: r.project_name,
  actor:
    r.actor_id && r.username
      ? {
          id: r.actor_id,
          firstName: r.first_name ?? "",
          lastName: r.last_name ?? "",
          username: r.username,
        }
      : null,
  payload: r.payload,
  count: r.count,
  createdAt: r.created_at.toISOString(),
  readAt: r.read_at?.toISOString() ?? null,
});

/** How many items the inbox returns at most. */
export const INBOX_LIMIT = 50;

/**
 * The inbox of every user. A notification is written once and pushed live (the gateway
 * listens to `events` and sends it to every tab of that person). Nobody is told about their
 * own actions.
 */
@Injectable()
export class NotificationsService {
  readonly events = new EventEmitter();

  constructor(@Inject(DB) private readonly pool: Pool) {}

  async notify(input: {
    userId: string;
    kind: NoticeKind;
    projectId?: string;
    actorId?: string;
    payload?: Record<string, unknown>;
    /** Unread items with the same key fold into one, counting up. */
    groupKey?: string;
    /** In the inbox, but already read: news that needs no badge (a version named). */
    quiet?: boolean;
  }): Promise<Notice | null> {
    if (input.actorId && input.actorId === input.userId) return null;
    const params = [
      randomUUID(),
      input.userId,
      input.kind,
      input.projectId ?? null,
      input.actorId ?? null,
      JSON.stringify(input.payload ?? {}),
      input.groupKey ?? null,
    ];
    const res = input.groupKey
      ? await this.pool.query<{ id: string }>(
          `INSERT INTO app.notifications (id, user_id, kind, project_id, actor_id, payload, group_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, group_key) WHERE group_key IS NOT NULL AND read_at IS NULL
           DO UPDATE SET count = app.notifications.count + 1, created_at = now(),
                         actor_id = EXCLUDED.actor_id, payload = EXCLUDED.payload
           RETURNING id`,
          params,
        )
      : await this.pool.query<{ id: string }>(
          `INSERT INTO app.notifications
             (id, user_id, kind, project_id, actor_id, payload, group_key, read_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8 THEN now() END) RETURNING id`,
          [...params, input.quiet === true],
        );
    const id = res.rows[0]?.id;
    if (!id) return null;
    const one = await this.pool.query<Row>(
      `SELECT n.id, n.kind, n.project_id, p.name AS project_name, n.actor_id,
         u.first_name, u.last_name, u.username, n.payload, n.count, n.created_at, n.read_at
  FROM app.notifications n
  LEFT JOIN app.projects p ON p.id = n.project_id
  LEFT JOIN app.users u ON u.id = n.actor_id
       WHERE n.id = $1`,
      [id],
    );
    const row = one.rows[0];
    if (!row) return null;
    const notice = toNotice(row);
    this.events.emit("notification", input.userId, notice);
    return notice;
  }

  /** The newest items first, and how many are unread. */
  async inbox(userId: string): Promise<{ items: Notice[]; unread: number }> {
    const items = await this.pool.query<Row>(
      `SELECT n.id, n.kind, n.project_id, p.name AS project_name, n.actor_id,
         u.first_name, u.last_name, u.username, n.payload, n.count, n.created_at, n.read_at
  FROM app.notifications n
  LEFT JOIN app.projects p ON p.id = n.project_id
  LEFT JOIN app.users u ON u.id = n.actor_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2`,
      [userId, INBOX_LIMIT],
    );
    const unread = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.notifications WHERE user_id = $1 AND read_at IS NULL",
      [userId],
    );
    return { items: items.rows.map(toNotice), unread: unread.rows[0]?.n ?? 0 };
  }

  /** Marks the given items, or all of them, as read; only the person's own. */
  async markRead(userId: string, ids: string[] | "all"): Promise<void> {
    if (ids === "all") {
      await this.pool.query(
        "UPDATE app.notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL",
        [userId],
      );
      return;
    }
    await this.pool.query(
      `UPDATE app.notifications SET read_at = now()
       WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
      [userId, ids],
    );
  }
}
