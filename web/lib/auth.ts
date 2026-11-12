import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, sql } from "./db";
import { clientIp, userAgent } from "./security";

export type User = {
  id: number;
  email: string;
  name: string;
  role: "owner" | "master";
  phone: string | null;
  /** Two-factor authentication is set up. Required to use the panel (requireUser). */
  mfaEnabled: boolean;
  /** Which second factor: an authenticator app, a code by e-mail, or none yet. */
  mfaMethod: "app" | "email" | null;
};

const PRODUCTION = process.env.NODE_ENV === "production";
// "__Host-" makes the browser refuse the cookie unless it is Secure, host-only and path=/.
const COOKIE = PRODUCTION ? "__Host-pk_session" : "pk_session";
const MFA_COOKIE = PRODUCTION ? "__Host-pk_mfa" : "pk_mfa";
const CHALLENGE_MINUTES = 10;
export const CHALLENGE_TRIES = 5;
const OWNER_SESSION_HOURS = 14 * 24;
const MASTER_SESSION_HOURS = 12;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// scrypt N=2^15, r=8, p=1 (OWASP minimum); older hashes made with Node's default still verify.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt2$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64 || (scheme !== "scrypt" && scheme !== "scrypt2")) return false;
  const expected = Buffer.from(hashB64, "base64");
  const params = scheme === "scrypt2" ? SCRYPT : {};
  const actual = scryptSync(password.slice(0, PASSWORD_MAX), Buffer.from(saltB64, "base64"), expected.length, params);
  return timingSafeEqual(expected, actual);
}

/** Old hashes use weaker parameters; re-hash them after a successful login. */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith("scrypt2$");
}

// A real hash to compare against when the e-mail doesn't exist, so the response takes the same time.
const DUMMY_HASH = hashPassword(randomBytes(12).toString("hex"));
export function burnPasswordCheck(password: string) {
  verifyPassword(password, DUMMY_HASH);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(userId: number, role: User["role"]) {
  const token = randomBytes(32).toString("base64url");
  const hours = role === "master" ? MASTER_SESSION_HOURS : OWNER_SESSION_HOURS;
  const expires = new Date(Date.now() + hours * 3_600_000);
  await sql`insert into sessions (id_hash, user_id, expires_at, ip, user_agent)
            values (${tokenHash(token)}, ${userId}, ${expires.toISOString()}, ${await clientIp()}, ${await userAgent()})`;
  // Old sessions are cleaned up as people log in.
  await sql`delete from sessions where expires_at < now()`;
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: PRODUCTION,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql`delete from sessions where id_hash = ${tokenHash(token)}`;
  store.delete(COOKIE);
}

/** Ends every session of a user (blocked account, password change). */
export async function revokeSessions(userId: number) {
  await sql`delete from sessions where user_id = ${userId}`;
}

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await one`
    select u.id, u.email, u.name, u.role, u.phone, u.totp_enabled, u.email_mfa_enabled
    from sessions s join users u on u.id = s.user_id
    where s.id_hash = ${tokenHash(token)} and s.expires_at > now() and not u.blocked`;
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    phone: row.phone,
    mfaEnabled: !!row.totp_enabled || !!row.email_mfa_enabled,
    mfaMethod: row.totp_enabled ? "app" : row.email_mfa_enabled ? "email" : null,
  };
}

/** Signed in, whether or not 2FA is set up yet. Only the 2FA setup page and its actions use this. */
export async function requireSignedIn(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/entrar");
  return user;
}

/** Signed in AND with 2FA set up; anyone without it is sent to set it up first. */
export async function requireUser(): Promise<User> {
  const user = await requireSignedIn();
  if (!user.mfaEnabled) redirect("/conta/seguranca");
  return user;
}

export async function requireMaster(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "master") redirect("/painel");
  return user;
}

// ---------------------------------------------------------------- second-factor challenge

/** Password accepted: remember that only the second factor is missing (10 minutes, 5 tries). */
export async function startChallenge(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
  await sql`delete from login_challenges where user_id = ${userId} or expires_at < now()`;
  await sql`insert into login_challenges (id_hash, user_id, expires_at)
            values (${tokenHash(token)}, ${userId}, ${expires.toISOString()})`;
  const store = await cookies();
  store.set(MFA_COOKIE, token, { httpOnly: true, secure: PRODUCTION, sameSite: "lax", path: "/", expires });
}

/** The pending challenge, counting this try; null when missing, expired or out of tries. */
export async function takeChallengeAttempt(): Promise<{ userId: number; triesLeft: number } | null> {
  const store = await cookies();
  const token = store.get(MFA_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await one`update login_challenges set attempts = attempts + 1
                        where id_hash = ${tokenHash(token)} and expires_at > now() and attempts < ${CHALLENGE_TRIES}
                        returning user_id, attempts`;
  if (!row) return null;
  return { userId: Number(row.user_id), triesLeft: CHALLENGE_TRIES - Number(row.attempts) };
}

/** Whose login is waiting for the second factor, without spending a try (for resending the e-mail code). */
export async function challengeUserId(): Promise<number | null> {
  const store = await cookies();
  const token = store.get(MFA_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const row = await one`select user_id from login_challenges where id_hash = ${tokenHash(token)} and expires_at > now()
                        and attempts < ${CHALLENGE_TRIES}`;
  return row ? Number(row.user_id) : null;
}

export async function hasChallenge(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(MFA_COOKIE)?.value;
  if (!token || token.length > 100) return false;
  return !!(await one`select 1 from login_challenges where id_hash = ${tokenHash(token)} and expires_at > now()
                      and attempts < ${CHALLENGE_TRIES}`);
}

export async function endChallenge() {
  const store = await cookies();
  const token = store.get(MFA_COOKIE)?.value;
  if (token) await sql`delete from login_challenges where id_hash = ${tokenHash(token)}`;
  store.delete(MFA_COOKIE);
}
