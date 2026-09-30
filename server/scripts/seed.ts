/**
 * Demo data for a fresh database: three accounts, four projects with history from more than
 * one person, members, and one user's settings, bookmarks, a note and a facade survey. Made
 * through the server's own services, so every row is what the app itself would write: hashed
 * passwords, validated buildings, versions, stored project cards.
 *
 * Run with the database settings of the server (it starts in the repository root, where the
 * LoD2 fixtures and sample plans are):
 *   DATABASE_URL=... [DATABASE_CA_CERT=...] npm --prefix server run seed
 *
 * Passwords are made fresh and printed once. Accounts that exist already are left alone, and
 * so are their projects: running it twice adds nothing.
 */
import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleAltbau, exampleBlock, exampleHouse } from "@/lib/examples";
import { PRESET_IDS } from "@/geometry/constructions";
import { floorPlanEdits } from "@/geometry/floorPlanImport";
import type { Building } from "@/geometry/types";
import { diffBuilding } from "@/sync/ops";
import { createEditorStore } from "@/store/building";
import { analyzePart } from "@/lod2/analysis";
import { loadFixture, surveyFromFixture } from "@/lod2/testFixtures";
import { AuthRefused, AuthService } from "../src/auth/auth.service";
import type { AuthUser } from "../src/auth/auth.service";
import { createPool, ensureSchema } from "../src/db";
import { MeService } from "../src/me/me.service";
import { ProjectsService } from "../src/projects/projects.service";

const pool = createPool();
await ensureSchema(pool);
const auth = new AuthService({ mode: "on", secret: randomBytes(32) }, pool);
const projects = new ProjectsService(pool);
const me = new MeService(pool);

/** A strong password: the rules of src/auth/schema.ts, and not guessable. */
const password = () => `Bw-${randomBytes(9).toString("base64url")}7a`;

const PEOPLE = [
  { firstName: "Adilzhan", lastName: "Yerzhan", username: "adilzhan" },
  { firstName: "Lena", lastName: "Berg", username: "lena_berg" },
  { firstName: "Tom", lastName: "Wagner", username: "tom_wagner" },
];

const users: Record<string, AuthUser> = {};
const created: { username: string; password: string }[] = [];
for (const person of PEOPLE) {
  const pw = password();
  try {
    const session = await auth.signUp({ ...person, password: pw, confirmPassword: pw }, "seed");
    users[person.username] = session.user;
    created.push({ username: person.username, password: pw });
  } catch (error) {
    if (!(error instanceof AuthRefused && error.reason === "usernameTaken")) throw error;
    const res = await pool.query<{
      id: string;
      username: string;
      first_name: string;
      last_name: string;
    }>(
      "SELECT id, username, first_name, last_name FROM app.users WHERE lower(username) = lower($1)",
      [person.username],
    );
    const row = res.rows[0];
    if (!row) throw error;
    users[person.username] = {
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
    };
  }
}
const adilzhan = users.adilzhan;
const lena = users.lena_berg;
const tom = users.tom_wagner;
if (!adilzhan || !lena || !tom) throw new Error("the demo accounts are missing");
const name = (u: AuthUser) => `${u.firstName} ${u.lastName}`;

/** BOo in Berlin, from the LoD2 fixture, with the ground floor read from its old plan. */
function boo(): Building {
  const { detail, survey, neighbours } = loadFixture("DEBE02YY40000BOo");
  const result = analyzePart(
    detail,
    "DEBE02YY40000BOo",
    surveyFromFixture(survey),
    neighbours,
    "de",
  );
  if (!result.ok) throw new Error("BOo could not be analysed");
  const store = createEditorStore();
  store.getState().setLanguage("de");
  store.getState().loadBuilding(result.analysis.building);
  const ground = store.getState().building.storeys[0];
  if (!ground) throw new Error("BOo has no storey");
  const plan = JSON.parse(
    readFileSync(join(process.cwd(), "lod2/sample-plans/DEBE02YY40000BOo-EG.walls.json"), "utf8"),
  ) as {
    walls: { a: number[]; b: number[]; thickness?: number }[];
    doors: { a: number[]; b: number[] }[];
  };
  const xy = (p: number[]) => ({ x: p[0] ?? 0, y: p[1] ?? 0 });
  const b = store.getState().building;
  store.getState().applyFloorPlan(
    ground.id,
    floorPlanEdits(
      plan.walls.map((w) => ({
        a: xy(w.a),
        b: xy(w.b),
        ...(w.thickness ? { thickness: w.thickness } : {}),
      })),
      plan.doors.map((d) => ({ a: xy(d.a), b: xy(d.b) })),
      b.footprint,
      ground.height,
      b.constructions,
    ),
  );
  const building = store.getState().building;
  return {
    ...building,
    yearBuilt: 1905,
    project: { ...building.project, client: "WEG Lausitzer Straße", stage: "survey" },
  };
}

/** One edit by one person, as the editor would send it. */
async function edit(id: string, user: AuthUser, change: (b: Building) => Building, seq: number) {
  const project = await projects.get(id);
  if (!project) throw new Error("project gone");
  const ops = diffBuilding(project.building, change(project.building));
  if (ops.length === 0) return;
  const result = await projects.applyBatch(
    id,
    { clientId: `seed-${user.username}`, seq, ops, valid: true },
    name(user),
    user.id,
  );
  if (!result.ok) throw new Error(`edit refused: ${result.reason}`);
}

const owned = await pool.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM app.projects WHERE owner_id = $1",
  [adilzhan.id],
);
if ((owned.rows[0]?.n ?? 0) === 0) {
  // BOo: Adilzhan's survey project, Lena joins and plans the renovation with him.
  const booProject = await projects.create(boo(), name(adilzhan), adilzhan.id);
  if (!booProject.ok) throw new Error(`BOo refused: ${booProject.error.code}`);
  const booId = booProject.project.id;
  await projects.access(booId, lena, true);
  await edit(
    booId,
    lena,
    (b) => ({
      ...b,
      scenarios: [
        {
          id: "s-heatpump",
          name: "Wärmepumpe",
          overrides: {},
          heating: { carrier: "heatPumpAir", efficiency: 3.2, hotWater: 12.5 },
        },
        { id: "s-facade", name: "Fassade dämmen", overrides: { wall: PRESET_IDS.wallInsulated } },
      ],
    }),
    1,
  );
  await edit(
    booId,
    adilzhan,
    (b) => ({
      ...b,
      scenarios: [
        ...(b.scenarios ?? []),
        {
          id: "s-windows",
          name: "Fenster und Dach",
          overrides: { window: PRESET_IDS.glazingTriple, roof: PRESET_IDS.roofInsulated },
        },
      ],
      project: { ...b.project, stage: "variants" },
    }),
    1,
  );

  // The Altbau example, with Tom as a member.
  const altbau = await projects.create(exampleAltbau("de"), name(adilzhan), adilzhan.id);
  if (!altbau.ok) throw new Error("Altbau refused");
  await projects.access(altbau.project.id, tom, true);

  // A small house of Adilzhan's own.
  const house = exampleHouse("de");
  await projects.create(
    { ...house, project: { ...house.project, client: "Familie Schneider" } },
    name(adilzhan),
    adilzhan.id,
  );

  // Lena's office block, shared with Adilzhan.
  const block = await projects.create(exampleBlock("de"), name(lena), lena.id);
  if (!block.ok) throw new Error("block refused");
  await projects.access(block.project.id, adilzhan, true);

  // Adilzhan's own data: German, two bookmarked buildings, a note and the facade survey of BOo.
  await me.saveSettings(adilzhan.id, { language: "de", theme: "light", projectsView: "grid" });
  await me.setBookmark(adilzhan.id, "DEBE02YY40000BOo", true);
  await me.setBookmark(adilzhan.id, "DEBE02YY40000Atr", true);
  const survey = JSON.parse(
    readFileSync(
      join(process.cwd(), "lod2/lod2-core/fixtures/surveys/DEBE02YY40000BOo.json"),
      "utf8",
    ),
  ) as { partGid: string; surfaceIndex: number; openings: unknown[]; photo: string };
  await me.saveBuilding(adilzhan.id, "DEBE02YY40000BOo", {
    note: "Keller feucht an der Hofseite. Gasheizung von 1998, Warmwasser über die Heizung.",
    survey: {
      walls: {
        [`${survey.partGid}:${String(survey.surfaceIndex)}`]: {
          partGid: survey.partGid,
          surfaceIndex: survey.surfaceIndex,
          openings: survey.openings as never,
          photo: survey.photo,
          method: "detected",
          updatedAt: Date.now(),
        },
      },
      facts: { ageClass: "bis1918", ageClassConfirmed: true, storeys: 4 },
    },
  });
  await me.saveSettings(lena.id, { language: "de" });
}

// Fill the stored project cards now, as the first visit of the Projects page would.
for (const u of [adilzhan, lena, tom]) await projects.list(u);

const counts = await pool.query<{ t: string; n: number }>(
  `SELECT 'users' AS t, count(*)::int AS n FROM app.users
   UNION ALL SELECT 'projects', count(*)::int FROM app.projects
   UNION ALL SELECT 'versions', count(*)::int FROM app.project_events
   UNION ALL SELECT 'members', count(*)::int FROM app.project_members
   UNION ALL SELECT 'bookmarks', count(*)::int FROM app.user_bookmarks
   UNION ALL SELECT 'buildings', count(*)::int FROM app.user_buildings`,
);
console.log(counts.rows.map((r) => `${r.t} ${String(r.n)}`).join(", "));
for (const c of created) console.log(`account ${c.username}  password ${c.password}`);
if (created.length === 0)
  console.log("All accounts existed already; their passwords are unchanged.");
await pool.end();
