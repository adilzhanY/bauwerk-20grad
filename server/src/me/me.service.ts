import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DB } from "../db";
import type { Settings, Survey } from "./me.schema";

export interface UserData {
  settings: Settings;
  bookmarks: string[];
  buildings: { gid: string; note: string | null; survey: Survey | null }[];
}

/** A user's own data. Every query is bound to the user id from the token, never the client. */
@Injectable()
export class MeService {
  constructor(@Inject(DB) private readonly pool: Pool) {}

  async all(userId: string): Promise<UserData> {
    const [settings, bookmarks, buildings] = await Promise.all([
      this.pool.query<{
        language: string | null;
        theme: string | null;
        projects_view: string | null;
      }>("SELECT language, theme, projects_view FROM app.user_settings WHERE user_id = $1", [
        userId,
      ]),
      this.pool.query<{ gid: string }>(
        "SELECT gid FROM app.user_bookmarks WHERE user_id = $1 ORDER BY created_at",
        [userId],
      ),
      this.pool.query<{ gid: string; note: string | null; survey: Survey | null }>(
        "SELECT gid, note, survey FROM app.user_buildings WHERE user_id = $1 ORDER BY gid",
        [userId],
      ),
    ]);
    const s = settings.rows[0];
    return {
      settings: s
        ? {
            language: s.language as Settings["language"],
            theme: s.theme as Settings["theme"],
            projectsView: s.projects_view as Settings["projectsView"],
          }
        : {},
      bookmarks: bookmarks.rows.map((r) => r.gid),
      buildings: buildings.rows,
    };
  }

  /** Sets the given settings; the others keep their value. */
  async saveSettings(userId: string, patch: Settings): Promise<void> {
    await this.pool.query(
      `INSERT INTO app.user_settings (user_id, language, theme, projects_view)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         language = CASE WHEN $5 THEN EXCLUDED.language ELSE app.user_settings.language END,
         theme = CASE WHEN $6 THEN EXCLUDED.theme ELSE app.user_settings.theme END,
         projects_view = CASE WHEN $7 THEN EXCLUDED.projects_view ELSE app.user_settings.projects_view END,
         updated_at = now()`,
      [
        userId,
        patch.language ?? null,
        patch.theme ?? null,
        patch.projectsView ?? null,
        "language" in patch,
        "theme" in patch,
        "projectsView" in patch,
      ],
    );
  }

  async setBookmark(userId: string, gid: string, on: boolean): Promise<void> {
    if (on) {
      await this.pool.query(
        "INSERT INTO app.user_bookmarks (user_id, gid) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, gid],
      );
    } else {
      await this.pool.query("DELETE FROM app.user_bookmarks WHERE user_id = $1 AND gid = $2", [
        userId,
        gid,
      ]);
    }
  }

  /** Sets or removes the note and the survey of one building; an entry with neither goes. */
  async saveBuilding(
    userId: string,
    gid: string,
    patch: { note?: string | null; survey?: Survey | null },
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ note: string | null; survey: Survey | null }>(
        "SELECT note, survey FROM app.user_buildings WHERE user_id = $1 AND gid = $2 FOR UPDATE",
        [userId, gid],
      );
      const row = current.rows[0] ?? { note: null, survey: null };
      const note = "note" in patch ? (patch.note === "" ? null : (patch.note ?? null)) : row.note;
      const survey = "survey" in patch ? (patch.survey ?? null) : row.survey;
      if (note === null && survey === null) {
        await client.query("DELETE FROM app.user_buildings WHERE user_id = $1 AND gid = $2", [
          userId,
          gid,
        ]);
      } else {
        await client.query(
          `INSERT INTO app.user_buildings (user_id, gid, note, survey) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, gid) DO UPDATE
             SET note = EXCLUDED.note, survey = EXCLUDED.survey, updated_at = now()`,
          [userId, gid, note, survey === null ? null : JSON.stringify(survey)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
