import { Inject, Injectable } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import type { Pool } from "pg";
import { signInSchema, signUpSchema, username as usernameRule } from "@/auth/schema";
import type { AccountData } from "@/auth/schema";
import { DB } from "../db";
import { Limiter } from "./limiter";
import { dummyHash, hashPassword, verifyPassword } from "./password";

/** Who is signed in: the account, as the app shows it. */
export type AuthUser = AccountData;

/** The name others see in presence and history. */
export const displayName = (user: AuthUser) => `${user.firstName} ${user.lastName}`;

/**
 * Accounts are our own (TODO Part 20): users in app.users, passwords checked here, sessions
 * as tokens signed with AUTH_SECRET. "off" is local development without a secret: nobody
 * signs in, as before accounts existed.
 */
export type AuthConfig = { mode: "off" } | { mode: "on"; secret: Uint8Array };

export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

/** Long enough that it cannot be guessed; `openssl rand -base64 48` gives 64 characters. */
export const AUTH_SECRET_MIN = 32;
const ISSUER = "bauwerk";
const AUDIENCE = "bauwerk";
/** A session lasts a week, then the user signs in again. */
export const SESSION = "7d";

/** The config from the environment. A production server without accounts refuses to start. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    // A production server runs without accounts only when told so in words, never because a
    // setting was forgotten.
    if (env.NODE_ENV === "production" && env.ACCOUNTS !== "off") {
      throw new Error(
        "AUTH_SECRET is not set. A production server runs without accounts only with ACCOUNTS=off.",
      );
    }
    return { mode: "off" };
  }
  if (secret.length < AUTH_SECRET_MIN) {
    throw new Error(`AUTH_SECRET must be at least ${String(AUTH_SECRET_MIN)} characters long.`);
  }
  return { mode: "on", secret: new TextEncoder().encode(secret) };
}

/** A token that is missing, broken, expired, forged, or of an account that is gone. */
export class Unauthenticated extends Error {}

/** A sign up or sign in the server refuses, with the reason the client shows. */
export class AuthRefused extends Error {
  constructor(
    readonly reason: "invalid" | "usernameTaken" | "credentials" | "tooMany" | "off",
    readonly fields: Record<string, string> = {},
  ) {
    super(reason);
  }
}

export interface Session {
  token: string;
  user: AuthUser;
}

interface UserRow {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  password_hash: string;
}

const toUser = (r: UserRow): AuthUser => ({
  id: r.id,
  username: r.username,
  firstName: r.first_name,
  lastName: r.last_name,
});

/** Failed sign ins: 10 per username and 30 per address in 15 minutes. Sign ups: 10 per hour. */
const FAILS_PER_NAME = new Limiter(10, 15 * 60_000);
const FAILS_PER_ADDRESS = new Limiter(30, 15 * 60_000);
const SIGN_UPS_PER_ADDRESS = new Limiter(10, 60 * 60_000);

/** Only for the tests: forget every attempt. */
export function resetLimits() {
  for (const l of [FAILS_PER_NAME, FAILS_PER_ADDRESS, SIGN_UPS_PER_ADDRESS]) l.reset();
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(DB) private readonly pool: Pool,
  ) {}

  get enabled(): boolean {
    return this.config.mode === "on";
  }

  private secret(): Uint8Array {
    if (this.config.mode !== "on") throw new AuthRefused("off");
    return this.config.secret;
  }

  private async issue(user: AuthUser): Promise<Session> {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(SESSION)
      .sign(this.secret());
    return { token, user };
  }

  /** A new account, signed in at once. Every field is checked by the shared schema. */
  async signUp(body: unknown, address: string): Promise<Session> {
    this.secret();
    if (!SIGN_UPS_PER_ADDRESS.allowed(address)) throw new AuthRefused("tooMany");
    const parsed = signUpSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        fields[String(issue.path[0] ?? "form")] ??= issue.message;
      throw new AuthRefused("invalid", fields);
    }
    const { firstName, lastName, username, password } = parsed.data;
    SIGN_UPS_PER_ADDRESS.record(address);
    const hash = await hashPassword(password);
    try {
      const res = await this.pool.query<UserRow>(
        `INSERT INTO app.users (username, first_name, last_name, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, first_name, last_name, password_hash`,
        [username, firstName, lastName, hash],
      );
      const row = res.rows[0];
      if (!row) throw new Error("insert returned no row");
      return await this.issue(toUser(row));
    } catch (error) {
      // The unique index decides a race between two sign ups with one name.
      if ((error as { code?: string }).code === "23505") {
        throw new AuthRefused("usernameTaken", { username: "auth.error.usernameTaken" });
      }
      throw error;
    }
  }

  /**
   * Username and password. Every failure answers the same, whether the name exists or not,
   * and takes the same time; failures are counted per name and per address.
   */
  async signIn(body: unknown, address: string): Promise<Session> {
    this.secret();
    const parsed = signInSchema.safeParse(body);
    if (!parsed.success) throw new AuthRefused("credentials");
    const name = parsed.data.username.toLowerCase();
    if (!FAILS_PER_NAME.allowed(name) || !FAILS_PER_ADDRESS.allowed(address)) {
      throw new AuthRefused("tooMany");
    }
    const res = await this.pool.query<UserRow>(
      `SELECT id, username, first_name, last_name, password_hash
         FROM app.users WHERE lower(username) = lower($1)`,
      [parsed.data.username],
    );
    const row = res.rows[0];
    const ok = await verifyPassword(
      parsed.data.password,
      row?.password_hash ?? (await dummyHash()),
    );
    if (!row || !ok) {
      FAILS_PER_NAME.record(name);
      FAILS_PER_ADDRESS.record(address);
      throw new AuthRefused("credentials");
    }
    FAILS_PER_NAME.clear(name);
    return this.issue(toUser(row));
  }

  /** The signed in user behind a token. Throws Unauthenticated for anything else. */
  async verify(token: string | undefined): Promise<AuthUser> {
    if (this.config.mode !== "on") throw new Unauthenticated("accounts are off");
    if (!token) throw new Unauthenticated("no token");
    let sub: string;
    try {
      const { payload } = await jwtVerify(token, this.config.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      });
      if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("no subject");
      sub = payload.sub;
    } catch (error) {
      throw new Unauthenticated(error instanceof Error ? error.message : "invalid token");
    }
    if (!/^[0-9a-f-]{36}$/i.test(sub)) throw new Unauthenticated("bad subject");
    // The name and the account itself come from the database on every request: a deleted
    // account stops working at once, whatever its token says.
    const res = await this.pool.query<UserRow>(
      "SELECT id, username, first_name, last_name, password_hash FROM app.users WHERE id = $1",
      [sub],
    );
    const row = res.rows[0];
    if (!row) throw new Unauthenticated("no such account");
    return toUser(row);
  }

  /** Whether a username may still be taken, and whether it has the allowed form at all. */
  async usernameAvailable(name: string): Promise<{ valid: boolean; available: boolean }> {
    const valid = usernameRule.safeParse(name).success;
    if (!valid) return { valid, available: false };
    const res = await this.pool.query("SELECT 1 FROM app.users WHERE lower(username) = lower($1)", [
      name.trim(),
    ]);
    return { valid, available: res.rowCount === 0 };
  }
}
