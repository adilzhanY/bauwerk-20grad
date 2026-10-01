import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import type { Pool } from "pg";
import { z } from "zod";
import type { Building, Note } from "@/geometry/types";
import { diffBuilding } from "@/sync/ops";
import { DB } from "../db";
import { NotificationsService } from "../notifications/notifications.service";
import { ProjectsService } from "../projects/projects.service";

/** What a thread is about: the same things a note could be about. */
export const Target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("building") }),
  z.object({ kind: z.literal("wall"), wallIndex: z.number().int().min(0).max(999) }),
  z.object({ kind: z.literal("opening"), storeyId: z.string().max(128), id: z.string().max(128) }),
  z.object({ kind: z.literal("room"), storeyId: z.string().max(128), id: z.string().max(128) }),
  z.object({ kind: z.literal("storey"), id: z.string().max(128) }),
]);
export type Target = z.infer<typeof Target>;

export interface Comment {
  id: string;
  authorId: string | null;
  authorName: string;
  text: string;
  attachments: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface Thread {
  id: string;
  target: Target;
  version: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  comments: Comment[];
}

export interface Author {
  id?: string;
  name: string;
}

type Outcome = "ok" | "notFound" | "forbidden" | "invalid";

/** @username in a comment: the same characters usernames are made of. */
const MENTION = /(?:^|[^A-Za-z0-9_-])@([A-Za-z0-9_-]{3,24})/g;

export function mentionedNames(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((m) => (m[1] ?? "").toLowerCase()))];
}

/**
 * Threads about the building (TODO Part 21, CE). Callers check the role (see to read, comment
 * to write); this service keeps threads apart per project, tells the people concerned
 * (mentions, replies) and announces every change ("changed", projectId) for the live view.
 */
@Injectable()
export class ThreadsService implements OnModuleInit {
  readonly events = new EventEmitter();
  private readonly log = new Logger("threads");

  constructor(
    @Inject(DB) private readonly pool: Pool,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async list(projectId: string): Promise<Thread[]> {
    const threads = await this.pool.query<{
      id: string;
      target: Target;
      version: number;
      created_at: Date;
      resolved_at: Date | null;
      resolved_by: string | null;
    }>(
      `SELECT id, target, version, created_at, resolved_at, resolved_by FROM app.threads
       WHERE project_id = $1 ORDER BY created_at`,
      [projectId],
    );
    const comments = await this.pool.query<{
      id: string;
      thread_id: string;
      author_id: string | null;
      author_name: string;
      text: string;
      attachments: string[];
      created_at: Date;
      edited_at: Date | null;
    }>(
      `SELECT c.id, c.thread_id, c.author_id, c.author_name, c.text, c.attachments,
              c.created_at, c.edited_at
       FROM app.comments c JOIN app.threads t ON t.id = c.thread_id
       WHERE t.project_id = $1 ORDER BY c.created_at`,
      [projectId],
    );
    const byThread = new Map<string, Comment[]>();
    for (const c of comments.rows) {
      const list = byThread.get(c.thread_id) ?? [];
      list.push({
        id: c.id,
        authorId: c.author_id,
        authorName: c.author_name,
        text: c.text,
        attachments: c.attachments,
        createdAt: c.created_at.toISOString(),
        editedAt: c.edited_at?.toISOString() ?? null,
      });
      byThread.set(c.thread_id, list);
    }
    return threads.rows.map((t) => ({
      id: t.id,
      target: t.target,
      version: t.version,
      createdAt: t.created_at.toISOString(),
      resolvedAt: t.resolved_at?.toISOString() ?? null,
      resolvedBy: t.resolved_by,
      comments: byThread.get(t.id) ?? [],
    }));
  }

  /** Attachments must be files of this same project. */
  private async ownFiles(projectId: string, ids: readonly string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const res = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM app.project_files WHERE project_id = $1 AND id = ANY($2::uuid[])",
      [projectId, ids],
    );
    return res.rows[0]?.n === new Set(ids).size;
  }

  async create(
    projectId: string,
    target: Target,
    text: string,
    attachments: readonly string[],
    author: Author,
  ): Promise<{ outcome: Outcome; threadId?: string }> {
    if (!(await this.ownFiles(projectId, attachments))) return { outcome: "invalid" };
    const project = await this.projects.get(projectId);
    if (!project) return { outcome: "notFound" };
    const threadId = randomUUID();
    await this.pool.query(
      `INSERT INTO app.threads (id, project_id, target, version, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [threadId, projectId, JSON.stringify(target), project.version, author.id ?? null],
    );
    await this.addComment(threadId, text, attachments, author);
    await this.tell(projectId, threadId, text, author, []);
    this.events.emit("changed", projectId);
    return { outcome: "ok", threadId };
  }

  async reply(
    projectId: string,
    threadId: string,
    text: string,
    attachments: readonly string[],
    author: Author,
  ): Promise<Outcome> {
    if (!(await this.inProject(projectId, threadId))) return "notFound";
    if (!(await this.ownFiles(projectId, attachments))) return "invalid";
    // Earlier writers who are still members: someone removed from the project hears nothing
    // more of it, not even a reply in a thread they once wrote in.
    const before = await this.pool.query<{ author_id: string }>(
      `SELECT DISTINCT c.author_id FROM app.comments c
       JOIN app.project_members m ON m.user_id = c.author_id AND m.project_id = $2
       WHERE c.thread_id = $1`,
      [threadId, projectId],
    );
    await this.addComment(threadId, text, attachments, author);
    await this.tell(
      projectId,
      threadId,
      text,
      author,
      before.rows.map((r) => r.author_id),
    );
    this.events.emit("changed", projectId);
    return "ok";
  }

  private async addComment(
    threadId: string,
    text: string,
    attachments: readonly string[],
    author: Author,
  ) {
    await this.pool.query(
      `INSERT INTO app.comments (id, thread_id, author_id, author_name, text, attachments)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[])`,
      [randomUUID(), threadId, author.id ?? null, author.name, text, [...attachments]],
    );
  }

  /**
   * Mentioned members are told they were mentioned; everyone who wrote in the thread before is
   * told about the reply (folded per thread until read). Mentions of people without access
   * tell nobody.
   */
  private async tell(
    projectId: string,
    threadId: string,
    text: string,
    author: Author,
    earlier: readonly string[],
  ) {
    if (!author.id) return;
    const names = mentionedNames(text);
    const mentioned = names.length
      ? await this.pool.query<{ user_id: string }>(
          `SELECT m.user_id FROM app.project_members m JOIN app.users u ON u.id = m.user_id
           WHERE m.project_id = $1 AND lower(u.username) = ANY($2::text[])`,
          [projectId, names],
        )
      : { rows: [] };
    const excerpt = text.length > 140 ? `${text.slice(0, 139)}…` : text;
    const told = new Set<string>();
    for (const { user_id } of mentioned.rows) {
      told.add(user_id);
      await this.notifications.notify({
        userId: user_id,
        kind: "mentioned",
        projectId,
        actorId: author.id,
        payload: { threadId, text: excerpt },
      });
    }
    for (const userId of earlier) {
      if (told.has(userId)) continue;
      await this.notifications.notify({
        userId,
        kind: "replied",
        projectId,
        actorId: author.id,
        payload: { threadId, text: excerpt },
        groupKey: `reply:${threadId}`,
      });
    }
  }

  private async inProject(projectId: string, threadId: string): Promise<boolean> {
    const res = await this.pool.query(
      "SELECT 1 FROM app.threads WHERE id = $1 AND project_id = $2",
      [threadId, projectId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async resolve(
    projectId: string,
    threadId: string,
    resolved: boolean,
    by: string | undefined,
  ): Promise<Outcome> {
    const res = await this.pool.query(
      `UPDATE app.threads SET resolved_at = CASE WHEN $3 THEN now() ELSE NULL END,
              resolved_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END
       WHERE id = $1 AND project_id = $2`,
      [threadId, projectId, resolved, by ?? null],
    );
    if ((res.rowCount ?? 0) === 0) return "notFound";
    this.events.emit("changed", projectId);
    return "ok";
  }

  /** Only the author changes a comment's text. */
  async edit(projectId: string, commentId: string, text: string, userId: string): Promise<Outcome> {
    const res = await this.pool.query(
      `UPDATE app.comments c SET text = $3, edited_at = now()
       FROM app.threads t
       WHERE c.id = $1 AND c.thread_id = t.id AND t.project_id = $2 AND c.author_id = $4`,
      [commentId, projectId, text, userId],
    );
    if ((res.rowCount ?? 0) === 0) return "notFound";
    this.events.emit("changed", projectId);
    return "ok";
  }

  /** The author or the owner deletes a comment; a thread left empty goes with it. */
  async remove(
    projectId: string,
    commentId: string,
    userId: string | undefined,
    owner: boolean,
  ): Promise<Outcome> {
    const res = await this.pool.query<{ thread_id: string; author_id: string | null }>(
      `SELECT c.thread_id, c.author_id FROM app.comments c JOIN app.threads t ON t.id = c.thread_id
       WHERE c.id = $1 AND t.project_id = $2`,
      [commentId, projectId],
    );
    const row = res.rows[0];
    if (!row) return "notFound";
    if (!owner && (!userId || row.author_id !== userId)) return "forbidden";
    await this.pool.query("DELETE FROM app.comments WHERE id = $1", [commentId]);
    await this.pool.query(
      `DELETE FROM app.threads WHERE id = $1
       AND NOT EXISTS (SELECT 1 FROM app.comments WHERE thread_id = $1)`,
      [row.thread_id],
    );
    this.events.emit("changed", projectId);
    return "ok";
  }

  /**
   * The notes kept in buildings before threads existed move into threads once, with their
   * author and time; then they leave the building in one ordinary change (a version).
   */
  async onModuleInit() {
    const res = await this.pool.query<{ id: string; building: Building; version: number }>(
      "SELECT id, building, version FROM app.projects WHERE jsonb_array_length(COALESCE(building->'notes', '[]'::jsonb)) > 0",
    );
    for (const row of res.rows) {
      const notes: Note[] = row.building.notes ?? [];
      // The notes leave the building first, as one ordinary change. Only once that worked do
      // they become threads, so a refused change can never make them twice on the next start.
      const ops = diffBuilding(row.building, { ...row.building, notes: [] });
      const moved = await this.projects.applyBatch(
        row.id,
        // The project's version as the sequence: new for every attempt, so never taken for a
        // batch already applied, and it fits the integer column.
        { clientId: "bauwerk-notes", seq: row.version, ops, valid: true },
        "Bauwerk",
      );
      if (!moved.ok) {
        this.log.warn(`notes of project ${row.id} not moved: ${moved.reason}`);
        continue;
      }
      for (const note of notes) {
        const target = Target.safeParse(note.target);
        if (!target.success || !note.text.trim()) continue;
        const threadId = randomUUID();
        await this.pool.query(
          `INSERT INTO app.threads (id, project_id, target, version, created_at, resolved_at)
           VALUES ($1, $2, $3, (SELECT version FROM app.projects WHERE id = $2), $4,
                   CASE WHEN $5 THEN $4::timestamptz ELSE NULL END)`,
          [threadId, row.id, JSON.stringify(target.data), note.createdAt, note.done === true],
        );
        await this.pool.query(
          `INSERT INTO app.comments (id, thread_id, author_name, text, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            threadId,
            note.author.slice(0, 120) || "?",
            note.text.slice(0, 5000),
            note.createdAt,
          ],
        );
      }
      this.log.log(`moved ${String(notes.length)} notes of project ${row.id} into threads`);
    }
  }
}
