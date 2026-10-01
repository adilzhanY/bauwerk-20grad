import { Client } from "pg";

/**
 * The server tests share one database and empty its tables between tests. Two runs at once
 * (two worktrees, or an editor's test runner next to a terminal) would empty each other's
 * tables mid-test. A lock held for the whole run (vitest globalSetup) makes a second run
 * wait for the first.
 */
const LOCK = 208_022;
let client: Client | null = null;

export async function setup() {
  client = new Client({
    connectionString: process.env.DATABASE_URL ?? "postgres://bauwerk@127.0.0.1:5499/bauwerk_test",
  });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [LOCK]);
}

export async function teardown() {
  await client?.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
  await client?.end();
}
