import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

/**
 * Password hashes with scrypt from node:crypto: memory hard, so guessing on graphics cards is
 * slow, and no native package to build on the server. Every hash carries its own random salt
 * and its parameters, `scrypt$N$r$p$salt$hash`, so they can be raised later without breaking
 * the accounts made before.
 *
 * N = 2^15, r = 8, p = 1 is the OWASP recommendation for scrypt: about 32 MB and some tens of
 * milliseconds per hash.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Whether `password` is the one `hash` was made from. Constant time in the comparison. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = hash.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(
    password,
    Buffer.from(salt, "base64"),
    Number(n),
    Number(r),
    Number(p),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A hash of nothing anyone knows. Signing in with a username that does not exist is checked
 * against it, so it takes as long as a wrong password and the timing gives no hint which
 * usernames exist.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("base64"));
  return dummy;
}
