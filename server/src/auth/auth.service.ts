import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { Pool } from "pg";
import { DB } from "../db";

/** Who is signed in: the Supabase user id, and the username others see. */
export interface AuthUser {
  id: string;
  username: string;
}

/**
 * How tokens are checked. "off" is local development without Supabase: nobody signs in, as
 * before accounts existed. "supabase" checks every token, either against the project's key
 * set (JWKS, the default for Supabase projects) or, for a project still on the legacy shared
 * secret, with that secret.
 */
export type AuthConfig =
  { mode: "off" } | { mode: "supabase"; issuer: string; keys: JWTVerifyGetKey | Uint8Array };

export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

/** The config from the environment. A production server without Supabase refuses to start. */
export function authConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  if (!url) {
    // A production server runs without accounts only when told so in words (the first deploy,
    // before Supabase exists), never because a setting was forgotten.
    if (env.NODE_ENV === "production" && env.ACCOUNTS !== "off") {
      throw new Error(
        "SUPABASE_URL is not set. A production server runs without accounts only with ACCOUNTS=off.",
      );
    }
    return { mode: "off" };
  }
  const issuer = `${url}/auth/v1`;
  const secret = env.SUPABASE_JWT_SECRET;
  return secret
    ? { mode: "supabase", issuer, keys: new TextEncoder().encode(secret) }
    : {
        mode: "supabase",
        issuer,
        keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
      };
}

/** A token that is missing, broken, expired or from somewhere else. */
export class Unauthenticated extends Error {}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(DB) private readonly pool: Pool,
  ) {}

  get enabled(): boolean {
    return this.config.mode === "supabase";
  }

  /** The signed in user behind a token. Throws Unauthenticated for anything else. */
  async verify(token: string | undefined): Promise<AuthUser> {
    if (this.config.mode !== "supabase") throw new Unauthenticated("accounts are off");
    if (!token) throw new Unauthenticated("no token");
    let sub: string;
    let metadataName: unknown;
    try {
      const options = { issuer: this.config.issuer, audience: "authenticated" };
      const keys = this.config.keys;
      const { payload } =
        keys instanceof Uint8Array
          ? await jwtVerify(token, keys, options)
          : await jwtVerify(token, keys, options);
      if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("no subject");
      sub = payload.sub;
      metadataName = (payload.user_metadata as { username?: unknown } | undefined)?.username;
    } catch (error) {
      throw new Unauthenticated(error instanceof Error ? error.message : "invalid token");
    }
    // The name others see comes from the profile the sign up created, not from the client.
    const res = await this.pool.query<{ username: string }>(
      "SELECT username FROM app.profiles WHERE id = $1",
      [sub],
    );
    const username =
      res.rows[0]?.username ?? (typeof metadataName === "string" ? metadataName : "user");
    return { id: sub, username };
  }

  /** Whether a username may still be taken, and whether it has the allowed form at all. */
  async usernameAvailable(name: string): Promise<{ valid: boolean; available: boolean }> {
    const valid = USERNAME.test(name);
    if (!valid) return { valid, available: false };
    const res = await this.pool.query(
      "SELECT 1 FROM app.profiles WHERE lower(username) = lower($1)",
      [name],
    );
    return { valid, available: res.rowCount === 0 };
  }
}

/** The same rule as the check constraint in migrations/004_accounts.sql. */
export const USERNAME = /^[A-Za-z0-9_-]{3,24}$/;
