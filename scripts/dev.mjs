/**
 * `npm run dev`: everything the app needs, in one terminal.
 *
 *   1. the LoD2 database (PostGIS in Docker), waited for, then its migrations
 *   2. the LoD2 API
 *   3. the collaboration server (NestJS), on its own database in the same Postgres
 *   4. the vision service (SAM 3), only when its Python environment exists
 *   5. the floor plan service (interior walls from a plan), only when it is installed
 *   6. the app
 *
 * Every line is prefixed with the name of the process that wrote it. Ctrl+C stops them all.
 *
 * Accounts, projects and every user's data live in Supabase (TODO Part 20). Its settings
 * stay out of the repository, in ~/.config/bauwerk/supabase.env (BAUWERK_SUPABASE_ENV for
 * another file), which is loaded here: no start without it, so nobody signs in against an
 * empty local database by accident. `npm run dev -- --local-db` uses the local Postgres.
 *
 * `npm run dev -- --host` also serves the app on this computer's network address, so a
 * second machine on the same Wi-Fi can open it and join a shared project. Only the app
 * listens on the network: the API, the vision service and the collaboration server stay on
 * this computer and are reached through the app's proxy.
 * No dependency: plain child processes.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const localDb = process.argv.includes("--local-db");
const supabaseEnv =
  process.env.BAUWERK_SUPABASE_ENV ?? join(homedir(), ".config", "bauwerk", "supabase.env");
if (localDb) {
  delete process.env.DATABASE_CA_CERT;
} else {
  if (existsSync(supabaseEnv)) process.loadEnvFile(supabaseEnv);
  if (!process.env.BAUWERK_DATABASE_URL) {
    console.error(
      `No Supabase settings: ${supabaseEnv} is missing or has no BAUWERK_DATABASE_URL (deploy/README.md, "The database and accounts on Supabase"). Use npm run dev -- --local-db for the local database.`,
    );
    process.exit(1);
  }
}
const databaseUrl = localDb
  ? `postgres://lod2:lod2@127.0.0.1:${process.env.LOD2_DB_PORT ?? "55433"}/bauwerk`
  : (process.env.BAUWERK_DATABASE_URL ?? "");

const COLORS = { db: 90, api: 34, collab: 36, vision: 35, plans: 33, app: 32 };
const children = [];
let stopping = false;

function label(name) {
  return `\x1b[${COLORS[name] ?? 37}m${name.padEnd(6)}\x1b[0m`;
}

/** Print a child's output line by line with its name in front. */
function pipe(name, stream, out) {
  let rest = "";
  stream.on("data", (chunk) => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) out.write(`${label(name)} ${line}\n`);
  });
  stream.on("end", () => {
    if (rest) out.write(`${label(name)} ${rest}\n`);
  });
}

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  pipe(name, child.stdout, process.stdout);
  pipe(name, child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.log(
      `${label(name)} stopped (${signal ?? `exit code ${code}`}). The others keep running; Ctrl+C stops all.`,
    );
  });
  children.push(child);
  return child;
}

/** Run a short command to its end, with its output prefixed. False when it failed. */
function runOnce(name, command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, encoding: "utf8" });
  for (const line of `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n")) {
    if (line.trim()) console.log(`${label(name)} ${line}`);
  }
  return result.status === 0;
}

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    // Each child leads its own process group, so npm's own children stop with it.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

// 1. Database, then migrations. Without Docker the app still runs; the map stays empty.
const compose = [
  "compose",
  "-f",
  "lod2/docker-compose.yml",
  ...(existsSync(envFile) ? ["--env-file", ".env"] : []),
  "up",
  "-d",
  "--wait",
];
const dbUp = runOnce("db", "docker", compose);
if (dbUp) {
  runOnce("db", "npm", [
    "--prefix",
    "lod2/lod2-ingest",
    "run",
    "--silent",
    "lod2",
    "--",
    "migrate",
  ]);
} else {
  console.log(
    `${label("db")} Could not start the database. Is Docker running? The map will stay empty.`,
  );
}

// 2. API.
start("api", "npm", ["--prefix", "lod2/lod2-api", "run", "dev"]);

// 3. Collaboration server. It keeps its projects in a database of its own, `bauwerk`, in the
// same Postgres, created here on the first run. The app reaches it through the /collab proxy.
if (dbUp) {
  const exists = `psql -U lod2 -d lod2 -tAc "SELECT 1 FROM pg_database WHERE datname = 'bauwerk'" | grep -q 1`;
  runOnce("db", "docker", [
    "exec",
    "lod2-challenge-postgis",
    "sh",
    "-c",
    `${exists} || createdb -U lod2 bauwerk`,
  ]);
  console.log(
    `${label("collab")} Database: ${localDb ? "local Postgres (--local-db)" : `Supabase, ${new URL(databaseUrl).host}`}`,
  );
  // Files go to Supabase Storage only with both settings; without them the server keeps them
  // in the database (app.file_blobs) and moves them over on the first start that has them.
  const storage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  console.log(
    `${label("collab")} Files: ${storage ? `Supabase Storage, bucket "projects" on ${new URL(process.env.SUPABASE_URL ?? "").host}` : `in the database (no SUPABASE_URL and SUPABASE_SECRET_KEY${localDb ? "" : ` in ${supabaseEnv}`})`}`,
  );
  start("collab", "npm", ["--prefix", "server", "run", "dev"], {
    DATABASE_URL: databaseUrl,
    PORT: process.env.BAUWERK_SERVER_PORT ?? "8789",
    // Accounts on, with a fixed secret for this machine only, so a session survives a
    // restart. ACCOUNTS=off in the environment runs without accounts.
    ...(process.env.ACCOUNTS === "off"
      ? { ACCOUNTS: "off" }
      : {
          AUTH_SECRET:
            process.env.AUTH_SECRET ?? "bauwerk-local-development-secret-never-in-production",
        }),
  });
} else {
  console.log(`${label("collab")} Skipped without the database. Editing stays local.`);
}

// The key the hosted site's proxy and vite.config.ts send to the AI services (deploy/.env.pc).
// The home PC's tunnel reaches these ports, so with the key set they refuse anyone without it.
const pcEnv = join(root, "deploy", ".env.pc");
const visionKey = existsSync(pcEnv)
  ? /^VISION_KEY=(.+)$/m.exec(readFileSync(pcEnv, "utf8"))?.[1]?.trim()
  : undefined;
const keyEnv = visionKey ? { VISION_KEY: visionKey } : {};

// 4. Vision service, when it is installed.
const configuredPython = process.env.LOD2_VISION_PYTHON;
const visionPython = configuredPython
  ? resolve(root, configuredPython)
  : join(
      root,
      "lod2",
      "lod2-vision",
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
const visionPort = process.env.LOD2_VISION_PORT ?? "8790";
const visionRunning = await fetch(`http://127.0.0.1:${visionPort}/health`).then(
  () => true,
  () => false,
);
if (visionRunning) {
  // The always-on service of the hosted site (deploy/README.md, "From this PC"): share it.
  console.log(`${label("vision")} Already running on port ${visionPort}, using that one.`);
} else if (existsSync(visionPython)) {
  start("vision", "node", ["lod2/scripts/vision.mjs"], keyEnv);
} else {
  console.log(
    `${label("vision")} Not installed, skipped. Automatic window detection stays off (lod2/docs/LOD2.md, steps 6 to 8).`,
  );
}

// 5. Floor plan service (interior walls from a plan drawing), when it is installed.
const floorplanPython =
  process.env.LOD2_FLOORPLAN_PYTHON ??
  join(
    root,
    "lod2",
    "lod2-floorplan",
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
if (existsSync(floorplanPython)) {
  start("plans", floorplanPython, ["lod2/lod2-floorplan/server.py"], keyEnv);
} else {
  console.log(
    `${label("plans")} Not installed, skipped. Floor plan import stays off (lod2/lod2-floorplan/README.md).`,
  );
}

// 5. The app.
const lan = process.argv.includes("--host");
if (lan) {
  console.log(
    `${label("app")} Open the Network address below on the other machine, then open the same project there.`,
  );
}
start("app", "npx", ["vite", ...(lan ? ["--host"] : [])]);
